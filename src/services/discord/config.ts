export interface Permissions {
  /**
   * IDs of users who are authorized to execute admin commands.
   */
  userIds: string[];

  /**
   * IDs of user roles that have the rights to execute admin commands.
   */
  roleIds: string[];
}

export interface Monitor {
  /**
   * Guild id of the server where the channel to monitor can be found.
   */
  guildId: string;

  /**
   * ID of the discord channel to automatically monitor for events
   */
  channelId: string;
}

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
   * Settings for the automatic monitoring of messages from announcement channels.
   *
   * See: https://support.discord.com/hc/en-us/articles/360032008192-Announcement-Channels
   */
  monitor: Monitor;

  /**
   * Contains details about who is authorized to execute which kind of commands.
   */
  permissions: {
    /**
     * Access to administrator commands.
     */
    admin: Permissions;
  };
}
