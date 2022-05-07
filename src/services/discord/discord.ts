import { DiscordConfig } from './config';
import { Client, Intents, TextChannel } from 'discord.js';
import { DiscordIntegration } from '@infinityxyz/lib/types/core';
import { Routes } from 'discord-api-types/v9';
import { SlashCommandBuilder, SlashCommandSubcommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { DiscordAttachment, DiscordAnnouncementEvent, FeedEventType } from '@infinityxyz/lib/types/core/feed';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import Listener, { OnEvent } from '../listener';
import { DISCORD_VERIFICATION_URL } from '../../constants';

export const isDiscordIntegration = (item?: DiscordIntegration): item is DiscordIntegration => !!item;

export class Discord extends Listener<DiscordAnnouncementEvent> {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig, db: FirebaseFirestore.Firestore) {
    super(db);
    this.config = config;
  }

  async setup() {}

  /**
   * Registers all available 'slash commands'.
   */
  private async registerCommands(guildId: string) {
    const verifyCommand = new SlashCommandSubcommandBuilder()
      .setName('verify')
      .setDescription('Link this discord server to your NFT collection on infinity.xyz')
      .addStringOption((option) => option.setName('address').setDescription('Collection contract address').setRequired(true));

    const commands = [
      new SlashCommandBuilder()
        .setName('infinity')
        .setDescription('Commands to integrate with infinity.xyz')
        .addSubcommand(verifyCommand)
    ];

    const rest = new REST({ version: '9' }).setToken(this.config.token);

    await rest.put(Routes.applicationGuildCommands(this.config.appId, guildId), {
      body: commands.map((command) => command.toJSON())
    });
  }

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
      await this.registerCommands(guild.id);
    });

    client.on('interactionCreate', async (interaction) => {
      if (!interaction.isCommand()) return;

      const { commandName, options } = interaction;

      if (commandName === 'infinity' && options.getSubcommand() === 'verify') {
        const address = options.getString('address');
        // TODO: Verify based on unique token instead of guild id (Slightly better security, though unlikely a collection owner is gonna input a wrong guild id to sabotage themselves. The collection address is already securely verified.)
        interaction.reply(
          `Please click here to verify: ${DISCORD_VERIFICATION_URL}collection/integration?type=discord&address=${address}&guildId=${interaction.guildId}`
        );
      }
    });

    client.on('message', async (msg) => {
      const integrations = await this.db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .select('metadata.integrations.discord')
        .where('metadata.integrations.discord.guildId', '==', msg.guildId)
        .where('metadata.integrations.discord.channels', 'array-contains-any', [msg.channelId, (msg.channel as TextChannel).name])
        .get();
      if (integrations.size) {
        handler({
          id: msg.id,
          guildId: msg.guildId!,
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
          timestamp: Date.now()
        });
      }
    });

    await client.login(this.config.token);
  }
}
