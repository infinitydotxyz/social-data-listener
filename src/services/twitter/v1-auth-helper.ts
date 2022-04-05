import OAuth1Helper from 'twitter-api-v2/dist/client-mixins/oauth1.helper';
import { BotAccountConfig } from './twitter.types';

export class V1AuthHelper extends OAuth1Helper {
  constructor(config: BotAccountConfig) {
    super({
      consumerKeys: {
        key: config.apiKey,
        secret: config.apiKeySecret
      }
    });
  }

  public getAuthHeader(config: BotAccountConfig, request: { method: string; url: string; data?: object }) {
    const authorized = this.authorize(request, {
      key: config.accessTokenV1,
      secret: config.accessSecretV1
    });
    const authHeader = this.toHeader(authorized);
    return authHeader;
  }
}
