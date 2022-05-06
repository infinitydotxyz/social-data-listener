import { DiscordConfig } from './config';
import { Client, Intents, TextChannel } from 'discord.js';
import { Collection, DiscordIntegration } from '@infinityxyz/lib/types/core';
import { DiscordAttachment, DiscordAnnouncementEvent, FeedEventType } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import Listener, { OnEvent } from '../listener';
import { registerCommands, verifyCommand, linkCommand } from './commands';
import { SlashCommandStringOption } from '@discordjs/builders';

export const isDiscordIntegration = (item?: DiscordIntegration): item is DiscordIntegration => !!item;

export class Discord extends Listener<DiscordAnnouncementEvent> {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    this.config = config;
  }

  async setup() {}

  /**
   * Starts monitoring all discord channels this bot is connected to.
   *
   * Owners of verified collections are able to add this bot to their server.
   */
  async monitor(handler: OnEvent<DiscordAnnouncementEvent>) {
    const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

    client.once('ready', () => {
      console.log('Started monitoring discord channels');
    });

    // fired when joining a new discord server
    client.on('guildCreate', async (guild) => {
      await registerCommands(guild, this.config);
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const { commandName, options } = interaction;

      if (commandName == verifyCommand.name) {
        const address = options.getString((verifyCommand.options[0] as SlashCommandStringOption).name);
        interaction.reply(
          `Please click here to verify: ${process.env.DISCORD_VERIFICATION_URL}collection/integration?type=discord&address=${address}&guildId=${interaction.guildId}`
        );
      } else if (commandName == linkCommand.name) {
        const address = (linkCommand.options[0] as SlashCommandStringOption).name;
        const guildId = (linkCommand.options[1] as SlashCommandStringOption).name;

        const updateDocument = (document: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>) =>
          document.update({ metadata: { integrations: { discord: { guildId } } } } as Collection, { exists: true });

        let query = this.db.collection(firestoreConstants.COLLECTIONS_COLL);

        try {
          // document id
          if (address.includes(':')) {
            await updateDocument(query.doc(address));
          } else {
            const collections = await Promise.all([
              // TODO: performance?
              query.where('slug', '==', address).get(),
              query.where('metadata.name', '==', address).get()
            ]);

            for (const collection of collections) {
              if (collection.size) {
                for (const document of collection.docs) {
                  await updateDocument(document.ref);
                }
              }
            }
          }
        } catch (err) {
          console.error(err);
          interaction.reply('**Failed to link! See error log.**');
        }
      }
    });

    client.on('message', async (msg) => {
      const isMonitored =
        msg.type != 'CHANNEL_FOLLOW_ADD' &&
        msg.guildId == this.config.monitor.guildId &&
        msg.channelId == this.config.monitor.channelId;

      const integrations = await this.db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .select('metadata.integrations.discord')
        .where('metadata.integrations.discord.guildId', '==', msg.guildId)
        .where('metadata.integrations.discord.channels', 'array-contains-any', [msg.channelId, (msg.channel as TextChannel).name])
        .get();

      if (isMonitored || integrations.size) {
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
          type: FeedEventType.DiscordAnnouncement,
          comments: 0,
          likes: 0,
          timestamp: msg.createdTimestamp
        });
      }
    });

    await client.login(this.config.token);
  }
}
