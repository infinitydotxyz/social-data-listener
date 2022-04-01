/**
 * This script can be used to generate the required Oauth 2 Access and Refresh tokens for your twitter user account.
 *
 * Make sure you are signed in to a twitter account that may be used by this bot!
 */

import { TwitterApi } from 'twitter-api-v2';
import { config as loadEnv } from 'dotenv';
import express from 'express';

loadEnv();

const client = new TwitterApi({
  clientId: process.env.TWITTER_CLIENT_ID!,
  clientSecret: process.env.TWITTER_CLIENT_SECRET!
});

const {
  url,
  codeVerifier,
  state: sessionState
} = client.generateOAuth2AuthLink(process.env.TWITTER_OAUTH_CALLBACK_URL!, {
  scope: ['list.read', 'list.write', 'tweet.read', 'users.read', 'offline.access']
});

console.log(`Please click here to authorize the application: ${url}`);
console.log();

const app = express();
app.get('/callback', async (req, res) => {
  // extract state and code from query params
  const { state, code } = req.query;

  // verify
  if (!codeVerifier || !sessionState || !state || !code)
    return res.status(400).send('You denied the app or your session expired!');
  if (state !== sessionState) return res.status(400).send("Stored tokens didn't match!");

  try {
    const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
      code: code as string,
      codeVerifier,
      redirectUri: process.env.TWITTER_OAUTH_CALLBACK_URL!
    });
    console.log(`Access token: ${accessToken}`);
    console.log(`Refresh token: ${refreshToken}`);
    console.log(`Access token expires in: ${expiresIn}`);
    res.status(200).send('success');
  } catch (err) {
    res.status(403).send('Invalid verifier or access tokens!');
  }
});
app.listen(new URL(process.env.TWITTER_OAUTH_CALLBACK_URL ?? 'http://127.0.0.1:7777').port);
