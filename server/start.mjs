import { resolve } from 'node:path';
import { createApp, openDatabase } from './app.mjs';
const port = Number(process.env.PORT || 8000);
const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
const db = openDatabase(resolve(process.env.DATA_DIR || '.data', 'accounts.sqlite'));
const app = createApp({db,origin});
app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Kirtle Standard running at ${origin}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.close(()=>{db.close();process.exit(0);}));
