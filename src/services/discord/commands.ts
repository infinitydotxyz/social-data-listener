import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import { DiscordConfig } from './config';

export const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Link this discord server to your NFT collection on infinity.xyz')
  .addStringOption((option) => option.setName('address').setDescription('Collection contract address').setRequired(true));

export const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link a specific guild id to a NFT collection')
  .addStringOption((option) =>
    option.setName('collection').setDescription('Collection document id, name or slug').setRequired(true)
  )
  .addStringOption((option) => option.setName('guildid').setDescription('Discord server ID').setRequired(true));

/**
 * Permit no one (except server admin).
 */
const PERMISSION_NO_ONE = '0';

/**
 * Registers all available 'slash commands'.
 */
export async function registerCommands(config: DiscordConfig) {
  const rest = new REST({ version: '9' }).setToken(config.token);

  // TODO: wait for https://github.com/discordjs/discord.js/pull/7857 to be merged so we can set 'default_member_permissions' the proper way.

  // register global commands to be used in any server
  await rest.put(Routes.applicationCommands(config.appId), {
    body: [verifyCommand].map((command) => ({
      ...command.toJSON(),
      default_member_permissions: PERMISSION_NO_ONE,
      dm_permission: false
    }))
  });

  // register private commands to be used in infinity's moderation server only
  await rest.put(Routes.applicationGuildCommands(config.appId, config.adminGuildId), {
    body: [linkCommand].map((command) => ({ ...command.toJSON(), default_member_permissions: PERMISSION_NO_ONE }))
  });
}
