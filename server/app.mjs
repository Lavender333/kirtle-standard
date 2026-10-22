import { initializeJobs, createRequest, listJobs, getJob, reviewJob, updateJob, linkRequest } from './jobs.mjs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, chmodSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ttl = 8 * 60 * 60 * 1000;
const token = () => randomBytes(32).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
export function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex');
}
function verify(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function validUsername(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{3,32}$/.test(value)) fail(400, 'Use 3–32 letters, numbers, or underscores for your username.');
  return value;
}
function validPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) fail(400, 'Use a password between 8 and 128 characters.');
  return value;
}
export function createAccount(db, username, password, role) {
  validUsername(username); validPassword(password);
  if (!['owner', 'admin'].includes(role)) fail(400, 'Invalid role.');
  return db.prepare('INSERT INTO users (username,password_hash,role,created_at) VALUES (?,?,?,?)')
    .run(username, passwordHash(password), role, Date.now());
}
const publicUser = u => ({ id: u.id, username: u.username, role: u.role, disabled: !!u.disabled, createdAt: u.created_at });

export function createApp({ db, origin, square }) {
  const site = new URL(origin);
  if (site.origin !== origin || (site.protocol !== 'https:' && !['localhost','127.0.0.1','[::1]'].includes(site.hostname))) {
    throw new Error('APP_ORIGIN must be an HTTPS origin, or HTTP localhost for development.');
  }
  const secure = site.protocol === 'https:';
  const dummyHash = passwordHash(token());
  function audit(actor, action, target) {
    db.prepare('INSERT INTO audit (actor,action,target,created_at) VALUES (?,?,?,?)').run(actor, action, target, Date.now());
  }
  function limited(key, max) {
    const now = Date.now();
    db.prepare('DELETE FROM limits WHERE expires_at <= ?').run(now);
    const row = db.prepare('SELECT count FROM limits WHERE key=?').get(key);
    if (row?.count >= max) fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
    db.prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 900000);
  }
  function session(req) {
    const raw = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('kirtle_session='))?.slice(15);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    return db.prepare(`SELECT u.*,s.id AS session_id,s.csrf FROM sessions s JOIN users u ON s.user_id=u.id
      WHERE s.id=? AND s.expires_at>? AND u.disabled=0`).get(digest(raw), Date.now());
  }
  function cookie(res, value, age) {
    res.setHeader('Set-Cookie', `kirtle_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }
  function startSession(res, user) {
    const raw = token(), csrf = token();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(raw), user.id, csrf, Date.now() + ttl);
    cookie(res, raw, ttl / 1000);
    return { user: publicUser(user), csrf };
  }
  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use JSON.');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) fail(413, 'Request is too large.');
      chunks.push(chunk);
    }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; }
    catch { fail(400, 'Invalid request.'); }
  }
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== site.host) fail(403, 'Unrecognized website address.');
      const path = new URL(req.url, origin).pathname;
      if (!path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
        // An explicit public-file allowlist prevents serving the database or server source.
        const pages = ['/', '/index.html', '/about.html', '/booking.html', '/quote.html', '/forms.html', '/dashboard.html'];
        if (!pages.includes(path) && !/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|webp|png|jpg|jpeg|svg|pdf|docx)$/i.test(path)) fail(404, 'Not found.');
        let file;
        try { file = realpathSync(resolve(root, '.' + (path === '/' ? '/index.html' : path))); }
        catch { fail(404, 'Not found.'); }
        if (!file.startsWith(root + sep)) fail(404, 'Not found.');
        const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml', '.pdf':'application/pdf' };
        const content = readFileSync(file);
        res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      const write = !['GET','HEAD'].includes(req.method);
      if (write && req.headers.origin !== origin) fail(403, 'Please use this website to submit changes.');
      if (write) limited('write:' + req.socket.remoteAddress, 1000);
      if (path === '/api/requests' && req.method === 'POST') {
        limited('intake:' + req.socket.remoteAddress, 15);
        const data = await body(req);
        if (data.website) { json(res,200,{message:'Request received.'}); return; }
        const id = createRequest(db,data);
        json(res,201,{reference:id,message:'Your cleaning details are saved. We will review and confirm the appointment; no payment was taken.'}); return;
      }
      if (path === '/api/login' && req.method === 'POST') {
        limited('login-ip:' + req.socket.remoteAddress, 30);
        const data = await body(req);
        const name = typeof data.username === 'string' ? data.username.trim().slice(0, 128) : '';
        limited('login-name:' + name.toLowerCase(), 10);
        const user = db.prepare('SELECT * FROM users WHERE username=?').get(name);
        const pass = typeof data.password === 'string' && data.password.length <= 128 ? data.password : '';
        const matches = verify(pass, user?.password_hash || dummyHash);
        if (!matches || !user || user.disabled) fail(401, 'Username or password is incorrect.');
        const previous = session(req);
        if (previous) db.prepare('DELETE FROM sessions WHERE id=?').run(previous.session_id);
        db.prepare('DELETE FROM limits WHERE key=?').run('login-name:' + name.toLowerCase());
        audit(user.username, 'Signed in', user.username);
        json(res, 200, startSession(res, user)); return;
      }
      const user = session(req);
      if (!user) fail(401, 'Please log in to continue.');
      if (write && req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Your session changed. Refresh and try again.');
      if (path === '/api/jobs' && req.method === 'GET') { json(res,200,{jobs:listJobs(db)}); return; }
      if (path === '/api/square/status' && req.method === 'GET') { json(res,200,square?.status() || {configured:false,lastSuccess:null,lastError:''}); return; }
      if (path === '/api/square/sync' && req.method === 'POST') {
        limited('square-sync', 5);
        if (!square) fail(503,'Square is not connected yet.');
        const result=await square.sync();
        if (!session(req)) fail(401,'Please log in again.');
        json(res,200,result); return;
      }
      const jobRoute=path.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)(?:\/(review|link))?$/);
      if (jobRoute) {
        if (req.method==='GET' && !jobRoute[2]) { json(res,200,{job:getJob(db,jobRoute[1])}); return; }
        if (req.method==='PATCH') {
          const data=await body(req);
          if (!session(req)) fail(401,'Please log in again.');
          const job=jobRoute[2]==='review'?reviewJob(db,jobRoute[1],data,user.username):jobRoute[2]==='link'?linkRequest(db,jobRoute[1],data,user.username):updateJob(db,jobRoute[1],data,user.username);
          audit(user.username,jobRoute[2]==='review'?'Reviewed cleaning plan':jobRoute[2]==='link'?'Linked client intake':'Updated cleaning work',job.id);
          json(res,200,{job}); return;
        }
      }
      if (path === '/api/me' && req.method === 'GET') { json(res,200,{user:publicUser(user),csrf:user.csrf}); return; }
      if (path === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE id=?').run(user.session_id);
        cookie(res, '', 0); json(res,200,{ok:true}); return;
      }
      if (path === '/api/account' && req.method === 'PATCH') {
        const data = await body(req);
        if (session(req)?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
        limited('account:' + user.id, 10);
        if (Object.keys(data).some(k => !['username','password','currentPassword'].includes(k))) fail(400, 'Unsupported account change.');
        if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 128 || !verify(data.currentPassword,user.password_hash)) fail(400,'Current password is incorrect.');
        const username = data.username === undefined ? user.username : validUsername(typeof data.username === 'string' ? data.username.trim() : data.username);
        const hash = data.password === undefined ? user.password_hash : passwordHash(validPassword(data.password));
        if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,user.id)) fail(409,'That username is already taken.');
        db.exec('BEGIN');
        try {
          db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username,hash,user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          audit(user.username,'Updated own account',username);
          db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        json(res,200,startSession(res,db.prepare('SELECT * FROM users WHERE id=?').get(user.id))); return;
      }
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'admin') fail(403, 'Administrator access required.');
        if (path === '/api/admin/users' && req.method === 'GET') {
          json(res,200,{users:db.prepare('SELECT id,username,role,disabled,created_at FROM users ORDER BY id').all().map(publicUser)}); return;
        }
        if (path === '/api/admin/activity' && req.method === 'GET') {
          json(res,200,{activity:db.prepare('SELECT actor,action,target,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100').all()}); return;
        }
        const match = path.match(/^\/api\/admin\/users\/(\d+)$/);
        if (match && req.method === 'PATCH') {
          limited('admin:' + user.id,10);
          const data = await body(req);
          if (session(req)?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
          if (Object.keys(data).some(k=>!['username','password','disabled','currentPassword'].includes(k))) fail(400,'Unsupported account change.');
          if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 128 || !verify(data.currentPassword,user.password_hash)) fail(400,'Your current password is incorrect.');
          const target = db.prepare('SELECT * FROM users WHERE id=?').get(Number(match[1]));
          if (!target) fail(404,'Account not found.');
          if (target.role === 'admin') fail(403,'Use My account to update your own administrator account.');
          const username = data.username === undefined ? target.username : validUsername(typeof data.username === 'string' ? data.username.trim() : data.username);
          const hash = data.password === undefined ? target.password_hash : passwordHash(validPassword(data.password));
          if (data.disabled !== undefined && typeof data.disabled !== 'boolean') fail(400,'Invalid account status.');
          const disabled = data.disabled === undefined ? target.disabled : Number(data.disabled);
          if (db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username,target.id)) fail(409,'That username is already taken.');
          db.exec('BEGIN');
          try {
            db.prepare('UPDATE users SET username=?,password_hash=?,disabled=? WHERE id=?').run(username,hash,disabled,target.id);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
            audit(user.username,'Admin updated account',target.username + ' → ' + username + (disabled ? ' (disabled)' : ' (active)'));
            db.exec('COMMIT');
          } catch(e) { db.exec('ROLLBACK'); throw e; }
          json(res,200,{ok:true}); return;
        }
      }
      fail(404,'Not found.');
    } catch (error) {
      if (!error.status) console.error('Request failed:',error.code || error.name);
      json(res,error.status || 500,{error:error.status ? error.message : 'Something went wrong. Please try again.'});
    }
  });
}
