import { createSquareSync } from './square.mjs';
import { resolve } from 'node:path';
import { createApp, openDatabase, withDatabase } from './app.mjs';
const port = Number(process.env.PORT || 8000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const db = openDatabase(resolve(process.env.DATA_DIR || '.data', 'accounts.sqlite'));
const square = createSquareSync(db, {
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: process.env.SQUARE_ENVIRONMENT || 'production',
  locationId: process.env.SQUARE_LOCATION_ID
});
const app = createApp({
  db,
  origin,
  square
});
let syncTimer;
if ((await square.status()).configured) {
  const sync = () => withDatabase(db, () => square.sync()).catch(() => console.error('Square sync failed; check the authenticated dashboard for connection status.'));
  sync();
  syncTimer = setInterval(sync, 300000);
  syncTimer.unref();
}
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Kirtle Standard running at ${origin}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearInterval(syncTimer);
  app.close(() => {
    db.close();
    process.exit(0);
  });
});
