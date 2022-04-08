import { sleep } from '@infinityxyz/lib/utils';
import Emittery from 'emittery';
import PQueue from 'p-queue';
import phin from 'phin';
import { TwitterApi } from 'twitter-api-v2';
import { OAuth1RequestOptions } from 'twitter-api-v2/dist/client-mixins/oauth1.helper';
import {
  BasicResponse,
  BotAccountConfig,
  CreateListResponseData,
  ListTweetsResponse,
  UserIdResponseData,
  UserNotFoundError
} from '../twitter.types';
import { V1AuthHelper } from './v1-auth-helper';

const FIVE_MIN = 5 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const MAX_BACK_OFF = 3 * ONE_HOUR;
const MAX_REQUEST_ATTEMPTS = 3;

enum TwitterEndpoint {
  GetUser = 'get-user',
  BatchedGetUser = 'batched-get-user',
  CreateList = 'create-list',
  RemoveMemberFromList = 'remove-member-from-list',
  AddMemberToList = 'add-member-to-list',
  GetListTweets = 'get-list-tweets',
  BatchedAddMembersToList = 'batched-add-members-to-list'
}

interface Endpoint {
  /**
   * Remaining window until the rate limit resets
   * UTC epoch ms
   */
  rateLimitReset: number;

  /**
   * Number of requests left for the period
   */
  rateLimitRemaining: number;

  expBackOff: number;

  /**
   * Request queue for the endpoint
   */
  queue: PQueue;
}

export enum TwitterClientEvent {
  RateLimitExceeded = 'rate-limit-exceeded',
  UnknownResponseError = 'unknown-response-error',
  RefreshedToken = 'refreshed-token',
  TokenRefreshError = 'token-refresh-error'
}

type TwitterClientEvents = {
  [TwitterClientEvent.RateLimitExceeded]: { url: string; rateLimitReset: number; rateLimitRemaining: number; expBackOff: number };
  [TwitterClientEvent.UnknownResponseError]: { endpoint: TwitterEndpoint; response: string };
  [TwitterClientEvent.RefreshedToken]: { expiresIn: number };
  [TwitterClientEvent.TokenRefreshError]: Error;
};

export class TwitterClient extends Emittery<TwitterClientEvents> {
  private endpoints: Map<TwitterEndpoint, Endpoint> = new Map();

  /**
   * Allows an external client to update the credentials used
   */
  public updateConfig(config: BotAccountConfig) {
    this._config = config;
  }

  constructor(private _config: BotAccountConfig, private saveConfig?: (config: BotAccountConfig) => Promise<void>) {
    super();
    this.keepTokenFresh();
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
      Authorization: `Bearer ${this.config.accessTokenV2}`
    };
  }

  /**
   * Get a user object from twitter via a username
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

  public async getUsers(usernames: string[]): Promise<BasicResponse<UserIdResponseData[], UserNotFoundError | any>> {
    const response = await this.requestHandler<BasicResponse<UserIdResponseData[]>>(() => {
      return phin({
        method: 'GET',
        url: `https://api.twitter.com/2/users/by?usernames=${usernames.join(',')}`,
        headers: {
          ...this.authHeaders
        }
      });
    }, TwitterEndpoint.BatchedGetUser);
    return response;
  }

  /**
   * Add a user to a list
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

  async addListMembers(listId: string, screenNames: string[]): Promise<any> {
    const url = new URL('https://api.twitter.com/1.1/lists/members/create_all.json');
    url.searchParams.set('list_id', listId);
    url.searchParams.set('screen_name', screenNames.join(','));

    const response = await this.requestHandler<any>(async () => {
      const request: OAuth1RequestOptions = {
        method: 'POST',
        url: url.toString(),
        data: {}
      };
      const authHelper = new V1AuthHelper(this.config);
      const authHeaders = authHelper.getAuthHeader(this.config, request);
      const response = await phin({
        ...request,
        headers: {
          ...authHeaders
        }
      });
      return response;
    }, TwitterEndpoint.BatchedAddMembersToList);

    return response;
  }

  /**
   * Remove a user from a list
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
   * Create a new list
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

  public async getListTweets(listId: string, cursor: string, limit?: number) {
    const response = await this.requestHandler<ListTweetsResponse>(() => {
      const url = new URL(`https://api.twitter.com/2/lists/${listId}/tweets`);
      const params = new URLSearchParams({
        expansions: 'author_id,attachments.media_keys',
        'tweet.fields': 'author_id,created_at,id,lang,possibly_sensitive,source,text',
        'user.fields': 'location,name,profile_image_url,username,verified',
        'media.fields': 'height,width,preview_image_url,type,url,alt_text'
      });

      url.search = params.toString();

      if (cursor) {
        url.searchParams.append('pagination_token', cursor);
      }

      if (limit) {
        url.searchParams.append('max_results', limit.toString());
      }

      return phin({
        method: 'GET',
        url: url,
        headers: {
          ...this.authHeaders
        }
      });
    }, TwitterEndpoint.GetListTweets);

    return response;
  }

  private async requestHandler<Body>(
    request: () => Promise<phin.IResponse>,
    endpointId: TwitterEndpoint,
    attempts = 0
  ): Promise<Body> {
    let endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      endpoint = this.getDefaultEndpoint();
      this.endpoints.set(endpointId, endpoint);
    }

    const { response, successful, shouldRetry } = await endpoint.queue.add(async () => {
      if (endpoint?.rateLimitRemaining === 0 && endpoint?.rateLimitReset > Date.now()) {
        const rateLimitResetIn = endpoint.rateLimitReset - Date.now();
        await sleep(rateLimitResetIn);
      }
      const res = await request();

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.updateRateLimit(res, endpoint!);

      let retry = false;

      switch (res.statusCode) {
        case 200:
        case 201:
          return { response: res, successful: true, shouldRetry: false };

        case 401:
          await this.refreshToken();
          retry = true;
          break;

        case 429:
          retry = true;
          const sleepFor = endpoint?.expBackOff ?? 10_000;
          await sleep(sleepFor);
          break;

        default:
          void this.emit(TwitterClientEvent.UnknownResponseError, {
            endpoint: endpointId,
            response: res.body.toString()
          });
      }

      return { response: res, successful: false, shouldRetry: retry };
    });

    if (successful) {
      const buffer = response.body;
      const body = buffer.toString();
      const parsed = JSON.parse(body) as Body;
      return parsed;
    }

    if (attempts >= MAX_REQUEST_ATTEMPTS) {
      throw new Error(`Failed to make request in ${MAX_REQUEST_ATTEMPTS} attempts. Status Code: ${response.statusCode}`);
    } else if (shouldRetry) {
      return this.requestHandler(request, endpointId, attempts + 1);
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
      const prevBackOff = ep.expBackOff || 16_000;
      let expBackOff = Math.min(2 * (prevBackOff / 1000)) * 1000;
      expBackOff = expBackOff > MAX_BACK_OFF ? MAX_BACK_OFF : expBackOff;
      ep.expBackOff = expBackOff;
      void this.emit(TwitterClientEvent.RateLimitExceeded, {
        url: response.url || 'unknown',
        rateLimitRemaining,
        rateLimitReset,
        expBackOff
      });
    } else {
      ep.expBackOff = 0;
    }
  }

  private getDefaultEndpoint(): Endpoint {
    return {
      rateLimitRemaining: 300,
      rateLimitReset: FIFTEEN_MIN,
      queue: new PQueue({
        concurrency: 1,
        interval: 3000,
        intervalCap: 1
      }),
      expBackOff: 0
    };
  }

  private keepTokenFresh() {
    const refresh = async () => {
      try {
        await this.refreshToken();
      } catch (err) {
        const error = err instanceof Error ? err : new Error((err as any)?.toString?.());
        void this.emit(TwitterClientEvent.TokenRefreshError, error);
      }
    };

    refresh()
      .then(() => {
        setInterval(async () => {
          await refresh();
        }, 60_000);
      })
      .catch(console.error);
  }

  private get _tokenValid(): boolean {
    if (!this.config.refreshTokenValidUntil || typeof this.config.refreshTokenValidUntil !== 'number') {
      return false;
    }

    return this.config.refreshTokenValidUntil > Date.now() + FIVE_MIN;
  }

  /**
   * Handles refreshing an OAuth2 token
   * note - OAuth 1 tokens do not need to be refreshed they only become
   * invalid if the user revokes them
   */
  private async refreshToken(force?: boolean): Promise<void> {
    if (this._tokenValid && !force) {
      return;
    }

    const client = new TwitterApi({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret
    });

    const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(this.config.refreshTokenV2);

    if (!refreshToken) {
      throw new Error('failed to get refresh token');
    }

    const expiresInMs = expiresIn * 1000;
    void this.emit(TwitterClientEvent.RefreshedToken, { expiresIn: expiresInMs });

    const refreshTokenValidUntil = Date.now() + expiresInMs;

    this.config = {
      ...this.config,
      accessTokenV2: accessToken,
      refreshTokenV2: refreshToken,
      refreshTokenValidUntil
    };
  }
}
