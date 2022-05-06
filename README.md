# social-data-listener

## installation
```
$ npm i
$ cp .env.example .env
```

## development
Start the CLI program and watch for changes:

`npm run watch`

## production
```
$ npm run build
$ npm start
```

## listeners
Overview of all available services in this repository.

### Discord
Listens to messages posted in up to 3 `#announcements` channels in a NFT collection's Discord server.

Unfortunately due to limitations imposed on the Discord API this process isn't 100% automatic.
Collection owners need to add our Discord bot to their server, type in one command to verify and finally specify the channels they would like to monitor.
The bot takes care of the rest.
This process is fairly seamless, but people are reluctant to add a random bot to their server.
Therefore, some semi-manual process is involved so we can generate at least some feed events to incentivize people to get started with the discord integration as well.

### Twitter
Watches for tweets from all NFT collections using Twitter's [streaming API](https://developer.twitter.com/en/docs/twitter-api/tweets/filtered-stream/introduction).
This process is fully automatic and no manual intervention is required.

For now, only the `TWITTER_BEARER_TOKEN` environment variable is required to get it working.

### CoinMarketCap
Scrapes news articles from [CMC news](https://coinmarketcap.com/headlines/news/) every hour. These events are NOT linked to any NFT collections, they are just news items.
