import { sleep } from '@infinityxyz/lib/utils';
import Emittery from 'emittery';
import PQueue from 'p-queue';
import phin from 'phin';
import { TwitterApi } from 'twitter-api-v2';
import { BasicResponse, BotAccountConfig, CreateListResponseData, UserIdResponseData } from './twitter.types';

const FIVE_MIN = 5 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

const MAX_REQUEST_ATTEMPTS = 3;

enum TwitterEndpoint {
  GetUser = 'get-user',
  CreateList = 'create-list',
  RemoveMemberFromList = 'remove-member-from-list',
  AddMemberToList = 'add-member-to-list'
}

interface Endpoint {
  /**
   * remaining window until the rate limit resets
   * UTC epoch ms
   */
  rateLimitReset: number;

  /**
   * number of requests left for the period
   */
  rateLimitRemaining: number;

  /**
   * request queue for the endpoint
   */
  queue: PQueue;
}

export enum TwitterClientEvent {
  RateLimitExceeded = 'rate-limit-exceeded',
  UnknownResponseError = 'unknown-response-error',
  RefreshedToken = 'refreshed-token'
}

type TwitterClientEvents = {
  [TwitterClientEvent.RateLimitExceeded]: { url: string; rateLimitReset: number; rateLimitRemaining: number };
  [TwitterClientEvent.UnknownResponseError]: { endpoint: TwitterEndpoint; response: phin.IResponse };
  [TwitterClientEvent.RefreshedToken]: { expiresIn: number };
};

export class TwitterClient extends Emittery<TwitterClientEvents> {
  private endpoints: Map<TwitterEndpoint, Endpoint> = new Map();

  /**
   * allows an external client to update the credentials used
   */
  public updateConfig(config: BotAccountConfig) {
    this._config = config;
  }

  constructor(private _config: BotAccountConfig, private saveConfig?: (config: BotAccountConfig) => Promise<void>) {
    super();
    this.keepTokenFresh();
  }

  /**
   * get a user object from twitter via a username
   */
  public async getUser(username: string): Promise<UserIdResponseData> {
    const response = await this.requestHandler<BasicResponse<UserIdResponseData>>(() => {
      return phin({
        method: 'GET',
        url: `https://api.twitter.com/2/users/by/username/${username}`,
        headers: {
          ...this.authHeaders
        }
      });
    }, TwitterEndpoint.GetUser);

    return response.data;
  }

  /**
   * add a user to a list
   */
  async addListMember(listId: string, memberId: string): Promise<{ isUserMember: boolean }> {
    const response = await this.requestHandler<BasicResponse<{ is_member: boolean }>>(() => {
      return phin({
        method: 'POST',
        url: `https://api.twitter.com/2/lists/${listId}/members`,
        headers: {
          ...this.authHeaders
        },
        data: {
          user_id: memberId
        }
      });
    }, TwitterEndpoint.AddMemberToList);

    const data = response.data;

    const isUserMember = data?.is_member;

    return {
      isUserMember
    };
  }

  /**
   * remove a user from a list
   */
  async removeListMember(listId: string, memberId: string): Promise<{ isUserMember: boolean }> {
    const response = await this.requestHandler<BasicResponse<{ is_member: boolean }>>(() => {
      return phin({
        method: 'DELETE',
        url: `https://api.twitter.com/2/lists/${listId}/members/${memberId}`,
        headers: {
          ...this.authHeaders
        }
      });
    }, TwitterEndpoint.RemoveMemberFromList);

    const data = response.data;

    const isUserMember = data?.is_member;

    return {
      isUserMember
    };
  }

  /**
   * create a new list
   */
  public async createTwitterList(name: string) {
    const response = await this.requestHandler<BasicResponse<CreateListResponseData>>(() => {
      return phin({
        method: 'POST',
        url: 'https://api.twitter.com/2/lists',
        headers: {
          ...this.authHeaders
        },
        data: {
          name
        }
      });
    }, TwitterEndpoint.CreateList);

    const data = response.data;

    if (!data?.id) {
      throw new Error(`Failed to create list`);
    }

    return {
      id: data.id,
      name: data.name
    };
  }

  private get config() {
    return this._config;
  }

  private set config(config: BotAccountConfig) {
    if (this.saveConfig) {
      this.saveConfig(config).catch((err) => {
        console.error('failed to update bot account config', err);
      });
    }
    this._config = config;
  }

  private get authHeaders() {
    return {
      Authorization: `Bearer ${this.config.accessToken}`
    };
  }

  private async requestHandler<Body>(
    request: () => Promise<phin.IResponse>,
    endpoint: TwitterEndpoint,
    attempts = 0
  ): Promise<Body> {
    let ep = this.endpoints.get(endpoint);
    if (!ep) {
      ep = this.getDefaultEndpoint();
      this.endpoints.set(endpoint, ep);
    }

    const response = await ep.queue.add(async () => {
      if (ep?.rateLimitRemaining === 0 && ep?.rateLimitReset > Date.now()) {
        const rateLimitResetIn = ep.rateLimitReset - Date.now();
        await sleep(rateLimitResetIn);
      }
      const res = await request();
      return res;
    });

    this.updateRateLimit(response, ep);

    let retry = false;
    switch (response.statusCode) {
      case 200:
        const buffer = response.body;
        const res = JSON.parse(buffer.toString()) as Body;
        return res;

      case 401:
        await this.refreshToken();
        retry = true;
        break;

      case 429:
        retry = true;
        break;

      default:
        this.emit(TwitterClientEvent.UnknownResponseError, {
          endpoint,
          response
        });
    }

    if (attempts >= MAX_REQUEST_ATTEMPTS) {
      throw new Error(`Failed to make request in ${MAX_REQUEST_ATTEMPTS} attempts. Status Code: ${response.statusCode}`);
    } else if (retry) {
      return this.requestHandler(request, endpoint, attempts + 1);
    } else {
      throw new Error(`Encountered unknown status code: ${response.statusCode} url: ${response.url}`);
    }
  }

  private updateRateLimit(response: phin.IResponse, ep: Endpoint) {
    const limitRemaining = response.headers['x-rate-limit-remaining'] as string;
    const limitReset = response.headers['x-rate-limit-reset'] as string;

    const resetInSeconds = parseInt(limitReset, 10);
    const rateLimitReset = resetInSeconds * 1000;
    const rateLimitRemaining = parseInt(limitRemaining, 10);

    ep.rateLimitRemaining = rateLimitRemaining;
    ep.rateLimitReset = rateLimitReset;

    if (response.statusCode === 429) {
      void this.emit(TwitterClientEvent.RateLimitExceeded, {
        url: response.url ?? 'unknown',
        rateLimitRemaining,
        rateLimitReset
      });
    }
  }

  private getDefaultEndpoint(): Endpoint {
    return {
      rateLimitRemaining: 300,
      rateLimitReset: FIFTEEN_MIN,
      queue: new PQueue({
        concurrency: 1
      })
    };
  }

  private keepTokenFresh() {
    const refresh = async () => {
      try {
        await this.refreshToken();
      } catch (err) {
        console.error(`Failed to refresh token`, err);
      }
    };

    refresh().then(() => {
      setInterval(async () => {
        await refresh();
      }, 60_000);
    });
  }

  private get _tokenValid(): boolean {
    if (!this.config.refreshTokenValidUntil || typeof this.config.refreshTokenValidUntil !== 'number') {
      return false;
    }

    return this.config.refreshTokenValidUntil > Date.now() + FIVE_MIN;
  }

  private async refreshToken(force?: boolean): Promise<void> {
    if (this._tokenValid && !force) {
      return;
    }

    const client = new TwitterApi({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret
    });

    const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(this.config.refreshToken);

    if (!refreshToken) {
      throw new Error('failed to get refresh token');
    }

    const expiresInMs = expiresIn * 1000;
    this.emit(TwitterClientEvent.RefreshedToken, { expiresIn: expiresInMs });

    const refreshTokenValidUntil = Date.now() + expiresInMs;

    this.config = {
      ...this.config,
      accessToken,
      refreshToken,
      refreshTokenValidUntil
    };
  }
}
