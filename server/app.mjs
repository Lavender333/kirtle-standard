import {initializeJobs} from './jobs.mjs';
import {createHandler} from './handler.mjs';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from './accounts.mjs';
export {createAccount,passwordHash} from './accounts.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function openDatabase(path) {
  mkdirSync(dirname(path), {
    recursive: true,
    mode: 0o700
  });
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin')),
      disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      target TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `);
  initializeJobs(db);
  return db;
}

const queues=new WeakMap();
export function withDatabase(db, action) {
  const current=(queues.get(db) || Promise.resolve()).then(action,action);
  queues.set(db,current.catch(()=>{}));
  return current;
}
export function createApp(options) {
  const handler=createHandler({...options,servePublic});
  return createServer((req,res)=>{
    withDatabase(options.db,()=>handler(req,res)).catch(()=>{
      res.writeHead(503,{'Content-Type':'application/json'});
      res.end(JSON.stringify({error:'The service is temporarily unavailable.'}));
    });
  });
}
function servePublic(req,res,path) {
        if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
        // An explicit public-file allowlist prevents serving the database or server source.
        const pages = ['/', '/index.html', '/about.html', '/booking.html', '/quote.html', '/forms.html', '/dashboard.html'];
        if (!pages.includes(path) && !/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|webp|png|jpg|jpeg|svg|pdf|docx)$/i.test(path)) fail(404, 'Not found.');
        let file;
        try {
          file = realpathSync(resolve(root, '.' + (path === '/' ? '/index.html' : path)));
        } catch {
          fail(404, 'Not found.');
        }
        if (!file.startsWith(root + sep)) fail(404, 'Not found.');
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.webp': 'image/webp',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.pdf': 'application/pdf'
        };
        const content = readFileSync(file);
        res.writeHead(200, {
          'Content-Type': types[extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(req.method === 'HEAD' ? undefined : content);
        return;
}
