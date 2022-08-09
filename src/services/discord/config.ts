export interface DiscordConfig {
  /**
   * Discord bot token.
   */
  token: string;

  /**
   * Application ID.
   */
  appId: string;

  /**
   * ID of the guild where admin commands are available.
   *
   * Please note that by default all admin commands have a permission of 0, meaning that only the server admin can access these unless configured otherwise.
   *
   * See: https://discord.com/blog/slash-commands-permissions-discord-apps-bots.
   */
  adminGuildId: string;

  /**
   * Name of the discord channel(s) to monitor announcements from other discord servers.
   *
   * Channels MUST exist within the admin guild!
   *
   * E.g `announcements` will match `#announcements`; `#announcements-1` and `#announcements-2`.
   */
  adminMonitorChannel: string;
}
