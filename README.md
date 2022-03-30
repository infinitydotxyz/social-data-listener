# social-data-listener

## installation
```
$ npm i
$ cp .env.example .env
```

## setup
### twitter
See https://github.com/PLhery/node-twitter-api-v2/blob/master/doc/auth.md#oauth2-user-wide-authentication-flow

1. Sign in to twitter and manually create a new list (to store the infinity collection accounts in). Copy the numeric ID that you can see in the url and paste it to the `TWITTER_LIST_ID` environment variable. Unfortunately the Tiwtter v2 API doesn't support the programmatic creation of lists yet, so this manual step is necessary.
2. Create a [Twitter developer account](https://developer.twitter.com) and [create a new project](https://developer.twitter.com/en/portal/projects).
3. Select your project and **enable OAuth 2.0**. Make sure to at least set the `Callback URI` to whatever `TWITTER_OAUTH_CALLBACK_URL` you want to use (see .env.example), hit save and store the client id and secret as the environment variables `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`.
4. If you haven't generated your access and refresh tokens yet or if they are expired, execute `npm run script:twitter` and store them in the `TWITTER_OAUTH_ACCESS_TOKEN` and `TWITTER_OAUTH_REFRESH_TOKEN` environment variables.  

## development
Start the CLI program and watch for changes:

`npm run start:dev`

## production
```
$ npm run build
$ npm start
```
