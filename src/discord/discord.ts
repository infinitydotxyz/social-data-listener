import { DiscordConfig } from './config';
import { Client, Intents } from 'discord.js';

export class Discord {
  private readonly config: DiscordConfig;

  constructor(config: DiscordConfig) {
    this.config = config;
  }

  /**
   * Starts monitoring all discord channels this bot is connected to.
   *
   * Owners of verified collections are able to add this bot to their server.
   */
  async monitor(channels: Set<string>) {
    console.log(channels);
    const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });

    client.once('ready', () => {
      console.log('Started monitoring channels');
    });

    client.on('message', (msg) => {
      if (channels.has(msg.channelId)) {
        console.log(msg.content);
      }
    });

    await client.login(this.config.token);
  }
}
