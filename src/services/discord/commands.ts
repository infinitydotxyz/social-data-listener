import { SlashCommandBuilder } from '@discordjs/builders';
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v9';
import { ApplicationCommandPermissionData, Guild } from 'discord.js';
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
  .addStringOption((option) => option.setName('guildid').setDescription('Discord server ID').setRequired(true))
  .setDefaultPermission(false);

/**
 * Registers all available 'slash commands'.
 */
export async function registerCommands(guild: Guild, config: DiscordConfig) {
  const commands = [verifyCommand, linkCommand];

  const rest = new REST({ version: '9' }).setToken(config.token);

  const res = await rest.put(Routes.applicationGuildCommands(config.appId, guild.id), {
    body: commands.map((command) => command.toJSON())
  });

  const rolePermissions: ApplicationCommandPermissionData[] = config.permissions.admin.roleIds.map((id) => ({
    id,
    type: 'ROLE',
    permission: true
  }));
  const userPermissions: ApplicationCommandPermissionData[] = config.permissions.admin.userIds.map((id) => ({
    id,
    type: 'USER',
    permission: true
  }));

  const { id } = (res as any[]).find((cmd) => cmd.name === linkCommand.name);

  const command = await guild.commands.fetch(id); // TODO: perhaps there's a more performant way to get the command instance cus we already know the command id from 'res'.

  // TODO: fix: setting permissions like this doesn't work anymore see https://github.com/discordjs/discord.js/issues/7856
  await command.permissions.set({ permissions: [...rolePermissions, ...userPermissions] });
}
