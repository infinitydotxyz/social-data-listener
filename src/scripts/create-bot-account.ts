/* eslint-disable @typescript-eslint/no-non-null-assertion */
import chalk from 'chalk';
import express from 'express';
import { TwitterApi } from 'twitter-api-v2';
import { socialDataFirestoreConstants } from '../constants';
import { firestore } from '../container';
import { BotAccountConfig } from '../services/twitter/twitter.types';

const success = (message?: any, ...optionalParams: any[]) => console.log(chalk.green(message, ...optionalParams, '\n'));
const error = (message?: any, ...optionalParams: any[]) => console.log(chalk.red(message, ...optionalParams, '\n'));
const info = (message?: any, ...optionalParams: any[]) => console.log(chalk.blue(message, ...optionalParams, '\n'));
const warn = (message?: any, ...optionalParams: any[]) => console.log(chalk.yellow(message, ...optionalParams, '\n'));

/**
 * Env variables
 * TWITTER_API_KEY
 * TWITTER_API_KEY_SECRET
 * TWITTER_CLIENT_ID
 * TWITTER_CLIENT_SECRET
 */

const CONSUMER_KEY = process.env.TWITTER_API_KEY!;
const CONSUMER_SECRET = process.env.TWITTER_API_KEY_SECRET!;
const BASE_CALLBACK_URL = new URL('http://127.0.0.1:7777/callback'!);

const clientId = process.env.TWITTER_CLIENT_ID!;
const clientSecret = process.env.TWITTER_CLIENT_SECRET!;

const v1CallbackUrl = new URL(`${BASE_CALLBACK_URL.toString()}/v1`);
const v2CallbackUrl = new URL(`${BASE_CALLBACK_URL.toString()}/v2`);

type V1Callback = (
  creds: Pick<BotAccountConfig, 'id' | 'username' | 'apiKey' | 'apiKeySecret' | 'accessTokenV1' | 'accessSecretV1'>
) => void;
let v1CredsCallback: V1Callback;
const v1Creds = new Promise((resolve: V1Callback) => {
  v1CredsCallback = resolve;
});
const v1Client = new TwitterApi({ appKey: CONSUMER_KEY, appSecret: CONSUMER_SECRET });

type V2Callback = (
  creds: Pick<
    BotAccountConfig,
    'id' | 'username' | 'clientId' | 'clientSecret' | 'accessTokenV2' | 'refreshTokenV2' | 'refreshTokenValidUntil'
  >
) => void;
let v2CredsCallback: V2Callback;
const v2Creds = new Promise((resolve: V2Callback) => {
  v2CredsCallback = resolve;
});
const v2Client = new TwitterApi({
  clientId,
  clientSecret
});

let authTokenSecret = '';
let codeVerifier = '';
let sessionState = '';

async function createAccount() {
  /**
   * V1 oauth
   */
  const authLink = await v1Client.generateAuthLink(v1CallbackUrl.toString(), {
    authAccessType: 'write'
  });
  info(`Click this link to authenticate the application for v1 endpoints`);
  warn(authLink.url);
  authTokenSecret = authLink.oauth_token_secret;

  info(`Waiting for v1 creds...`);
  try {
    const v1 = await v1Creds;
    success(`V1 creds received! Logged in as ${v1.username}`);
  } catch (err) {
    error('Failed to get v1 creds', err);
    throw err;
  }

  /**
   * V2 oauth
   */
  const v2AuthLink = v2Client.generateOAuth2AuthLink(v2CallbackUrl.toString(), {
    scope: ['list.read', 'list.write', 'tweet.read', 'users.read', 'offline.access']
  });
  codeVerifier = v2AuthLink.codeVerifier;
  sessionState = v2AuthLink.state;
  info(`Click this link to authenticate the application for v2 endpoints`);
  warn(v2AuthLink.url);
  info(`Waiting for v2 creds...`);
  try {
    const v2 = await v2Creds;
    success(`V2 creds received! Logged in as ${v2.username}`);
  } catch (err) {
    error('Failed to get v2 creds', err);
    throw err;
  }

  const [v1, v2] = await Promise.all([v1Creds, v2Creds]);
  if (v1.id !== v2.id) {
    throw new Error(`v1 and v2 creds do not match!`);
  } else {
    info(`Initializing bot account...`);

    const botAccountConfig: BotAccountConfig = {
      ...v1,
      ...v2,
      numLists: 0
    };

    const ref = firestore
      .collection(socialDataFirestoreConstants.SOCIAL_DATA_LISTENER_COLL)
      .doc(socialDataFirestoreConstants.TWITTER_DOC)
      .collection(socialDataFirestoreConstants.TWITTER_ACCOUNTS_COLL)
      .doc(botAccountConfig.username);

    const snap = await ref.get();
    const existingConfig = snap.data();

    const updatedConfig = {
      ...existingConfig,
      ...v1,
      ...v2,
      numLists: existingConfig?.numLists ?? 0
    };

    await ref.set(updatedConfig);

    success(`Bot account initialized! Exiting...`);
    process.exit();
  }
}

const app = express();

app.get(v1CallbackUrl.pathname, async (req, res) => {
  // Extract tokens from query string
  const { oauth_token, oauth_verifier } = req.query;
  // Get the saved oauth_token_secret from session

  if (!oauth_token || !oauth_verifier || !authTokenSecret) {
    return res.status(400).send('You denied the app or your session expired!');
  }

  // Obtain the persistent tokens
  // Create a client from temporary tokens
  const client = new TwitterApi({
    appKey: CONSUMER_KEY,
    appSecret: CONSUMER_SECRET,
    accessToken: oauth_token as string,
    accessSecret: authTokenSecret
  });

  info('Logging in...');

  try {
    const { client: loggedInClient, accessToken, accessSecret } = await client.login(oauth_verifier as string);
    const user = await loggedInClient.currentUser();
    const id = user.id_str;

    v1CredsCallback({
      username: user.screen_name,
      id,
      apiKey: CONSUMER_KEY,
      apiKeySecret: CONSUMER_SECRET,
      accessTokenV1: accessToken,
      accessSecretV1: accessSecret
    });
    res.status(200).send('success');
  } catch (err) {
    res.status(403).send('Invalid verifier or access tokens!');
  }
});

app.get(v2CallbackUrl.pathname, async (req, res) => {
  // Extract state and code from query params
  const { state, code } = req.query;

  // Verify
  if (!codeVerifier || !sessionState || !state || !code) {
    return res.status(400).send('You denied the app or your session expired!');
  }
  if (state !== sessionState) {
    return res.status(400).send("Stored tokens didn't match!");
  }

  try {
    const { client, accessToken, refreshToken, expiresIn } = await v2Client.loginWithOAuth2({
      code: code as string,
      codeVerifier,
      redirectUri: v2CallbackUrl.toString()
    });

    const { data } = await client.v2.me();

    v2CredsCallback({
      id: data.id,
      username: data.username,
      clientId,
      clientSecret,
      accessTokenV2: accessToken,
      refreshTokenV2: refreshToken as string,
      refreshTokenValidUntil: Date.now() + expiresIn * 1000
    });

    res.status(200).send('success');
  } catch (err) {
    res.status(403).send('Invalid verifier or access tokens!');
  }
});

app.listen(BASE_CALLBACK_URL.port, () => {
  success(`Listening on ${BASE_CALLBACK_URL.host} for callback to ${BASE_CALLBACK_URL.pathname}`);
  void createAccount();
});
