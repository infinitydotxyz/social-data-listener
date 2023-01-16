import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import { PermissionFlagsBits } from 'discord.js';
import { DiscordConfig } from './config';

export const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Link this discord server to your NFT collection on flow.so')
  .addStringOption((option) => option.setName('address').setDescription('Collection contract address').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link a specific guild id to a NFT collection')
  .addStringOption((option) =>
    option.setName('collection').setDescription('Collection document id, name or slug').setRequired(true)
  )
  .addStringOption((option) => option.setName('guildid').setDescription('Discord server ID').setRequired(true))
  .setDefaultMemberPermissions(PermissionFlagsBits.UseApplicationCommands)
  .setDMPermission(false);

/**
 * Registers all available 'slash commands'.
 */
export async function registerCommands(config: DiscordConfig) {
  const rest = new REST({ version: '10' }).setToken(config.token);

  // register global commands to be used in any server
  await rest.put(Routes.applicationCommands(config.appId), {
    body: [verifyCommand].map((command) => command.toJSON())
  });

  // register private commands to be used in infinity's moderation server only
  await rest.put(Routes.applicationGuildCommands(config.appId, config.adminGuildId), {
    body: [linkCommand].map((command) => command.toJSON())
  });
}
