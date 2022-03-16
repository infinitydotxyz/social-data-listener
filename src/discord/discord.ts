import { DiscordConfig } from './config';
import { Client, Intents } from 'discord.js';
import { DiscordIntegration } from '@infinityxyz/lib/types/core';
import { Routes } from 'discord-api-types/v9';
import { SlashCommandBuilder, SlashCommandSubcommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';

export const isDiscordIntegration = (item?: DiscordIntegration): item is DiscordIntegration => !!item;

export class Discord {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

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
  async monitor(discords: DiscordIntegration[]) {
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
        interaction.reply(
          `Please click here to verify: ${process.env.DISCORD_VERIFICATION_URL}collection/integration?type=discord&address=${address}&guildId=${interaction.guildId}`
        );
      }
    });

    client.on('message', (msg) => {
      if (discords.some((discord) => discord.guildId === msg.guildId && discord.channels?.includes(msg.channelId))) {
        console.log(msg.content);
      }
    });

    await client.login(this.config.token);
  }
}
