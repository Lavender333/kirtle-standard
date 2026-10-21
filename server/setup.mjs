// One-time provisioning. Credentials arrive on stdin, never from source code.
// JSON: [{"username":"...","password":"...","role":"owner|admin"}]
import { resolve } from 'node:path';
import { openDatabase, createAccount } from './app.mjs';
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 10000) throw Error('Input too large.'); }
const accounts = JSON.parse(input);
if (!Array.isArray(accounts) || !accounts.some(a=>a.role==='admin')) throw Error('Include an administrator.');
const db = openDatabase(resolve(process.env.DATA_DIR || '.data','accounts.sqlite'));
if (db.prepare('SELECT count(*) AS count FROM users').get().count) throw Error('Accounts already exist. Use the dashboard; provisioning will never overwrite them.');
db.exec('BEGIN');
try {
  for (const a of accounts) createAccount(db,a.username,a.password,a.role);
  db.exec('COMMIT');
  console.log('Accounts created. Passwords were hashed and are not displayed.');
} catch(e) { db.exec('ROLLBACK'); throw e; }
finally { db.close(); }
