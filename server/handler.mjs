import {createRequest,listJobs,getJob,reviewJob,updateJob,linkRequest} from './jobs.mjs';
import {ttl,token,digest,passwordHash,verify,fail,validUsername,validPassword,publicUser} from './accounts.mjs';
import {Buffer} from 'node:buffer';
const dummyHash=passwordHash(token());
export function createHandler({db, origin, square, bearer = false, servePublic}) {
  const site = new URL(origin);
  if (site.origin !== origin || site.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(site.hostname)) {
    throw new Error('APP_ORIGIN must be an HTTPS origin, or HTTP localhost for development.');
  }
  const secure = site.protocol === 'https:';

  async function audit(actor, action, target) {
    await db.prepare('INSERT INTO audit (actor,action,target,created_at) VALUES (?,?,?,?)').run(actor, action, target, Date.now());
  }
  async function limited(key, max) {
    const now = Date.now();
    await db.prepare('DELETE FROM limits WHERE expires_at <= ?').run(now);
    const row = await db.prepare('INSERT INTO limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=limits.count+1 RETURNING count').get(key, now + 900000);
    if (row.count > max) fail(429, 'Too many attempts. Please wait 15 minutes and try again.');
  }
  async function session(req) {
    const raw = bearer ? (req.headers.authorization || '').replace(/^Bearer /, '') : (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('kirtle_session='))?.slice(15);
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
    return await db.prepare(`SELECT u.*,s.id AS session_id,s.csrf FROM sessions s JOIN users u ON s.user_id=u.id
      WHERE s.id=? AND s.expires_at>? AND u.disabled=0`).get(digest(raw), Date.now());
  }
  function cookie(res, value, age) {
    res.setHeader('Set-Cookie', `kirtle_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`);
  }
  async function startSession(res, user) {
    const raw = token(),
      csrf = token();
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    await db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(digest(raw), user.id, csrf, Date.now() + ttl);
    if (!bearer) cookie(res, raw, ttl / 1000);
    return {
      user: publicUser(user),
      csrf,
      ...(bearer ? {sessionToken:raw} : {})
    };
  }
  function json(res, status, data) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use JSON.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) fail(413, 'Request is too large.');
      chunks.push(chunk);
    }
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
      return parsed;
    } catch {
      fail(400, 'Invalid request.');
    }
  }
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      if (req.headers.host !== site.host) fail(403, 'Unrecognized website address.');
      const path = new URL(req.url, origin).pathname;
      if (!path.startsWith('/api/')) {
        if (!servePublic) fail(404, 'Not found.');
        return servePublic(req, res, path);
      }
      if (path === '/api/health' && req.method === 'GET') {
        await db.prepare('SELECT 1 AS ok').get();
        json(res, 200, {ok:true}); return;
      }
      res.setHeader('Cache-Control', 'no-store');
      const write = !['GET', 'HEAD'].includes(req.method);
      if (write && req.headers.origin !== origin) fail(403, 'Please use this website to submit changes.');
      if (write) await limited('write:' + req.socket.remoteAddress, 1000);
      if (path === '/api/requests' && req.method === 'POST') {
        await limited('intake:' + req.socket.remoteAddress, 15);
        const data = await body(req);
        if (data.website) {
          json(res, 200, {
            message: 'Request received.'
          });
          return;
        }
        const id = await createRequest(db, data);
        json(res, 201, {
          reference: id,
          message: 'Your cleaning details are saved. We will review and confirm the appointment; no payment was taken.'
        });
        return;
      }
      if (path === '/api/login' && req.method === 'POST') {
        await limited('login-ip:' + req.socket.remoteAddress, 30);
        const data = await body(req);
        const name = typeof data.username === 'string' ? data.username.trim().slice(0, 128) : '';
        await limited('login-name:' + name.toLowerCase(), 10);
        const user = await db.prepare('SELECT * FROM users WHERE username=?').get(name);
        const pass = typeof data.password === 'string' && data.password.length <= 128 ? data.password : '';
        const matches = verify(pass, user?.password_hash || dummyHash);
        if (!matches || !user || user.disabled) fail(401, 'Username or password is incorrect.');
        await db.exec('BEGIN');
        try {
          const fresh = await db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
          if (!fresh || fresh.disabled || fresh.password_hash !== user.password_hash) fail(401, 'Account changed. Please log in again.');
        const previous = await session(req);
        if (previous) await db.prepare('DELETE FROM sessions WHERE id=?').run(previous.session_id);
        await db.prepare('DELETE FROM limits WHERE key=?').run('login-name:' + name.toLowerCase());
        await audit(user.username, 'Signed in', user.username);
        const result = await startSession(res, user);
        await db.exec('COMMIT');
        json(res, 200, result);
        } catch(error) { await db.exec('ROLLBACK'); throw error; }
        return;
      }
      const user = await session(req);
      if (!user) fail(401, 'Please log in to continue.');
      if (write && req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Your session changed. Refresh and try again.');
      if (path === '/api/jobs' && req.method === 'GET') {
        json(res, 200, {
          jobs: await listJobs(db)
        });
        return;
      }
      if (path === '/api/square/status' && req.method === 'GET') {
        json(res, 200, (await square?.status()) || {
          configured: false,
          lastSuccess: null,
          lastError: ''
        });
        return;
      }
      if (path === '/api/square/sync' && req.method === 'POST') {
        await limited('square-sync', 5);
        if (!square) fail(503, 'Square is not connected yet.');
        const result = await square.sync();
        if (!(await session(req))) fail(401, 'Please log in again.');
        json(res, 200, result);
        return;
      }
      const jobRoute = path.match(/^\/api\/jobs\/([a-zA-Z0-9-]+)(?:\/(review|link))?$/);
      if (jobRoute) {
        if (req.method === 'GET' && !jobRoute[2]) {
          json(res, 200, {
            job: await getJob(db, jobRoute[1])
          });
          return;
        }
        if (req.method === 'PATCH') {
          const data = await body(req);
          if (!(await session(req))) fail(401, 'Please log in again.');
          const job = jobRoute[2] === 'review' ? await reviewJob(db, jobRoute[1], data, user.username) : jobRoute[2] === 'link' ? await linkRequest(db, jobRoute[1], data, user.username) : await updateJob(db, jobRoute[1], data, user.username);
          await audit(user.username, jobRoute[2] === 'review' ? 'Reviewed cleaning plan' : jobRoute[2] === 'link' ? 'Linked client intake' : 'Updated cleaning work', job.id);
          json(res, 200, {
            job
          });
          return;
        }
      }
      if (path === '/api/me' && req.method === 'GET') {
        json(res, 200, {
          user: publicUser(user),
          csrf: user.csrf
        });
        return;
      }
      if (path === '/api/logout' && req.method === 'POST') {
        await db.prepare('DELETE FROM sessions WHERE id=?').run(user.session_id);
        cookie(res, '', 0);
        json(res, 200, {
          ok: true
        });
        return;
      }
      if (path === '/api/account' && req.method === 'PATCH') {
        const data = await body(req);
        if ((await session(req))?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
        await limited('account:' + user.id, 10);
        if (Object.keys(data).some(k => !['username', 'password', 'currentPassword'].includes(k))) fail(400, 'Unsupported account change.');
        if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 128 || !verify(data.currentPassword, user.password_hash)) fail(400, 'Current password is incorrect.');
        const username = data.username === undefined ? user.username : validUsername(typeof data.username === 'string' ? data.username.trim() : data.username);
        const hash = data.password === undefined ? user.password_hash : passwordHash(validPassword(data.password));
        if (await db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username, user.id)) fail(409, 'That username is already taken.');
        await db.exec('BEGIN');
        try {
          if ((await session(req))?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
          await db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(username, hash, user.id);
          await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
          await audit(user.username, 'Updated own account', username);
          const nextSession = await startSession(res, await db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
          await db.exec('COMMIT');
          json(res, 200, nextSession);
        } catch (e) {
          await db.exec('ROLLBACK');
          throw e;
        }
        return;
      }
      if (path.startsWith('/api/admin/')) {
        if (user.role !== 'admin') fail(403, 'Administrator access required.');
        if (path === '/api/admin/users' && req.method === 'GET') {
          json(res, 200, {
            users: (await db.prepare('SELECT id,username,role,disabled,created_at FROM users ORDER BY id').all()).map(publicUser)
          });
          return;
        }
        if (path === '/api/admin/activity' && req.method === 'GET') {
          json(res, 200, {
            activity: await db.prepare('SELECT actor,action,target,created_at AS createdAt FROM audit ORDER BY id DESC LIMIT 100').all()
          });
          return;
        }
        const match = path.match(/^\/api\/admin\/users\/(\d+)$/);
        if (match && req.method === 'PATCH') {
          await limited('admin:' + user.id, 10);
          const data = await body(req);
          if ((await session(req))?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
          if (Object.keys(data).some(k => !['username', 'password', 'disabled', 'currentPassword'].includes(k))) fail(400, 'Unsupported account change.');
          if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 128 || !verify(data.currentPassword, user.password_hash)) fail(400, 'Your current password is incorrect.');
          await db.exec('BEGIN');
          try {
          if ((await session(req))?.password_hash !== user.password_hash) fail(401, 'Please log in again.');
          const target = await db.prepare('SELECT * FROM users WHERE id=?').get(Number(match[1]));
          if (!target) fail(404, 'Account not found.');
          if (target.role === 'admin') fail(403, 'Use My account to update your own administrator account.');
          const username = data.username === undefined ? target.username : validUsername(typeof data.username === 'string' ? data.username.trim() : data.username);
          const hash = data.password === undefined ? target.password_hash : passwordHash(validPassword(data.password));
          if (data.disabled !== undefined && typeof data.disabled !== 'boolean') fail(400, 'Invalid account status.');
          const disabled = data.disabled === undefined ? target.disabled : Number(data.disabled);
          if (await db.prepare('SELECT id FROM users WHERE username=? AND id<>?').get(username, target.id)) fail(409, 'That username is already taken.');
            await db.prepare('UPDATE users SET username=?,password_hash=?,disabled=? WHERE id=?').run(username, hash, disabled, target.id);
            await db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
            await audit(user.username, 'Admin updated account', target.username + ' → ' + username + (disabled ? ' (disabled)' : ' (active)'));
            await db.exec('COMMIT');
          } catch (e) {
            await db.exec('ROLLBACK');
            throw e;
          }
          json(res, 200, {
            ok: true
          });
          return;
        }
      }
      fail(404, 'Not found.');
    } catch (error) {
      if (error.code === '23505' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') { error.status = 409; error.message = 'This record already exists. Refresh and try again.'; }
      if (!error.status) console.error('Request failed:', error.code || error.name);
      json(res, error.status || 500, {
        error: error.status ? error.message : 'Something went wrong. Please try again.'
      });
    }
  };
}
