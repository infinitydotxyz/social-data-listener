import { DiscordConfig } from './config';
import { Client, IntentsBitField, MessageType, TextChannel } from 'discord.js';
import { Collection, DiscordIntegration } from '@infinityxyz/lib/types/core';
import { DiscordAttachment, DiscordAnnouncementEvent, EventType } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import Listener, { OnEvent } from '../listener';
import { registerCommands, verifyCommand, linkCommand } from './commands';
import { SlashCommandStringOption } from '@discordjs/builders';
import { DISCORD_VERIFICATION_URL, NODE_ENV } from '../../constants';

export const isDiscordIntegration = (item?: DiscordIntegration): item is DiscordIntegration => !!item;

export class Discord extends Listener<DiscordAnnouncementEvent> {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    this.config = config;
  }

  async setup() {
    await registerCommands(this.config);
  }

  /**
   * Starts monitoring all discord channels this bot is connected to.
   *
   * Owners of verified collections are able to add this bot to their server.
   */
  async monitor(handler: OnEvent<DiscordAnnouncementEvent>) {
    const client = new Client({
      intents: [IntentsBitField.Flags.Guilds, IntentsBitField.Flags.GuildMessages, IntentsBitField.Flags.MessageContent]
    });

    client.once('ready', () => {
      console.log('Started monitoring discord channels');
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const { commandName, options } = interaction;

      if (commandName == verifyCommand.name) {
        const address = options.get((verifyCommand.options[0] as SlashCommandStringOption).name, true);

        interaction.reply({
          content: `Please click here to verify: ${DISCORD_VERIFICATION_URL}collection/integration?type=discord&address=${address}&guildId=${interaction.guildId}`,
          ephemeral: true
        });
      } else if (commandName == linkCommand.name) {
        const nftCollection = options.get((linkCommand.options[0] as SlashCommandStringOption).name, true).value?.toString();
        const guildId = options.get((linkCommand.options[1] as SlashCommandStringOption).name, true).value?.toString();

        if (!nftCollection) throw new Error('Nft collection unspecified!');

        const updateDocument = (document: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>) =>
          document.update('metadata.integrations.discord.guildId', guildId);

        let query = this.db.collection(firestoreConstants.COLLECTIONS_COLL);

        let results: Collection[] = [];

        try {
          // document id
          if (nftCollection.includes(':')) {
            const doc = query.doc(nftCollection);
            await updateDocument(doc);
            results.push((await doc.get()).data() as Collection);
          } else {
            const searchQueries = [query.where('slug', '==', nftCollection), query.where('metadata.name', '==', nftCollection)];

            for (const searchQuery of searchQueries) {
              const collection = await searchQuery.get();

              if (collection.size > 0) {
                for (const document of collection.docs) {
                  await updateDocument(document.ref);
                  results.push(document.data() as Collection);
                }

                break;
              }
            }
          }
        } catch (err) {
          console.error(err);
          interaction.reply('**Failed to link! See error log.**');
        }

        if (results.length > 0) {
          interaction.reply(
            `Linked discord server with ID \`${guildId}\` to collection \`${nftCollection}\` (${results
              .map((c) => c.metadata.name)
              .join(', ')}).`
          );
        } else {
          interaction.reply('**Failed to find the NFT collection**');
        }
      }
    });

    client.on('messageCreate', async (msg) => {
      console.log('Received discord announcement', NODE_ENV === 'dev' ? msg : JSON.stringify(msg));

      const channel = msg.guild?.channels.cache.find((c) => c.id === msg.channelId);

      let collectionData: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;

      // whether the message was sent to an announcement channel in the 'Inifnity Discord Listener' server
      const isMonitored =
        msg.type != MessageType.ChannelFollowAdd &&
        msg.guildId == this.config.adminGuildId &&
        channel?.name.startsWith(this.config.adminMonitorChannel);

      if (isMonitored) {
        // integration enabled by Infinity mods
        collectionData = await this.db
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .where('metadata.integrations.discord.guildId', '==', msg.reference?.guildId)
          .limit(1)
          .get();
      } else {
        // integration enabled by collection owner
        collectionData = await this.db
          .collection(firestoreConstants.COLLECTIONS_COLL)
          .where('metadata.integrations.discord.guildId', '==', msg.guildId)
          .where('metadata.integrations.discord.channels', 'array-contains-any', [
            msg.channelId,
            (msg.channel as TextChannel).name
          ])
          .limit(1)
          .get();
      }

      if (collectionData.size > 0) {
        const collection = collectionData.docs[0].data() as Collection;

        console.log(
          'Writing discord announcement to feed for collection',
          collection.chainId,
          collection.metadata?.name,
          collection.address
        );
        handler({
          id: msg.id,
          guildId: msg.reference?.guildId || msg.guildId!,
          authorId: msg.author.id,
          author: msg.author.username,
          content: msg.content,
          attachments: msg.attachments?.map(
            (attachment) =>
              ({
                url: attachment.url,
                width: attachment.width,
                height: attachment.height,
                contentType: attachment.contentType,
                description: attachment.description,
                name: attachment.name
              } as DiscordAttachment)
          ),
          type: EventType.DiscordAnnouncement,
          comments: 0,
          likes: 0,
          timestamp: msg.createdTimestamp,
          collectionName: collection.metadata?.name ?? '',
          collectionSlug: collection.slug ?? '',
          collectionProfileImage: collection.metadata?.profileImage ?? '',
          chainId: collection.chainId,
          collectionAddress: collection.address,
          hasBlueCheck: collection.hasBlueCheck ?? false,
          internalUrl: ''
        });
      } else {
        console.warn(
          'Discord message received but no collection found for guildId',
          msg.reference?.guildId ?? msg.guild,
          'channelId',
          msg.channelId
        );
      }
    });

    await client.login(this.config.token);
  }
}
