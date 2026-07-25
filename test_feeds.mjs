import { LiveFeed } from './worker/feeds.mjs';

const feed = new LiveFeed({ log: console.log });
feed.startDiscovery();

console.log('Waiting for new tokens and fetching prices...');
setInterval(() => {
  feed.updatePrices();
  console.log('\n--- Active Roster ---');
  for (const mint in feed.tokens) {
    const t = feed.tokens[mint];
    if (t.active) {
      console.log(`[${t.symbol}] ${t.name} | Cap: $${t.marketCap} | Price: ${t.priceNative} SOL | Migrated: ${t.isMigrated}`);
    }
  }
}, 5000);

setTimeout(() => {
  console.log('Exiting test');
  process.exit(0);
}, 20000);
