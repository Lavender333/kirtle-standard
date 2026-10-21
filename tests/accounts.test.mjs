import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, openDatabase, createAccount } from '../server/app.mjs';

test('account lifecycle, admin isolation, security, and persistent storage', async () => {
  const dir = mkdtempSync(join(tmpdir(),'kirtle-test-'));
  const dbPath = join(dir,'accounts.sqlite');
  const db = openDatabase(dbPath);
  createAccount(db,'TestOwner','Owner-pass-123','owner');
  createAccount(db,'TestAdmin','Admin-pass-123','admin');
  const port = 19000 + Math.floor(Math.random() * 10000);
  const origin = `http://127.0.0.1:${port}`;
  const app = createApp({db,origin});
  await new Promise(resolve=>app.listen(port,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  async function call(path,method='GET',body,identity={},extra={}) {
    const res = await fetch(base+path,{method,headers:{origin,'content-type':'application/json',
      ...(identity.cookie?{cookie:identity.cookie,'x-csrf-token':identity.csrf}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    const json = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
    return {status:res.status,data:json,cookie:res.headers.get('set-cookie')?.split(';')[0],csrf:json.csrf,headers:res.headers};
  }
  const login = (username,password)=>call('/api/login','POST',{username,password});
  try {
    assert.equal((await call('/api/admin/users')).status,401);
    for(const path of ['/server/app.mjs','/.data/accounts.sqlite','/.git/config','/.env','/package.json']) assert.equal((await call(path)).status,404);
    assert.equal((await login('TestOwner','wrong')).status,401);
    assert.equal((await call('/api/login','POST',{username:'TestOwner',password:'Owner-pass-123'},{},{origin:'https://evil.test'})).status,403);
    let owner = await login('testowner','Owner-pass-123');
    assert.equal(owner.status,200);assert.equal(owner.data.user.role,'owner');
    assert.match(owner.headers.get('set-cookie'),/HttpOnly/);assert.match(owner.headers.get('set-cookie'),/SameSite=Strict/);
    assert.equal((await call('/api/admin/users','GET',null,owner)).status,403);
    assert.equal((await call('/api/admin/activity','GET',null,owner)).status,403);
    assert.equal((await call('/api/account','PATCH',{role:'admin',currentPassword:'Owner-pass-123'},owner)).status,400);
    assert.equal((await call('/api/account','PATCH',{username:'Changed',currentPassword:'Owner-pass-123'},owner,{'x-csrf-token':'wrong'})).status,403);
    assert.equal((await call('/api/account','PATCH',{username:'Changed',currentPassword:'wrong'},owner)).status,400);
    assert.equal((await call('/api/account','PATCH',{username:'TESTADMIN',currentPassword:'Owner-pass-123'},owner)).status,409);
    assert.equal((await call('/api/account','PATCH',{username:'<script>',currentPassword:'Owner-pass-123'},owner)).status,400);
    const secondOwner = await login('TestOwner','Owner-pass-123');
    const changed = await call('/api/account','PATCH',{username:'ChangedOwner',password:'Changed-pass-456',currentPassword:'Owner-pass-123'},owner);
    assert.equal(changed.status,200);assert.equal(changed.data.user.username,'ChangedOwner');
    assert.equal((await call('/api/me','GET',null,owner)).status,401);
    assert.equal((await call('/api/me','GET',null,secondOwner)).status,401);
    assert.equal((await call('/api/me','GET',null,changed)).status,200);
    assert.equal((await login('TestOwner','Owner-pass-123')).status,401);
    assert.equal((await login('ChangedOwner','Owner-pass-123')).status,401);
    owner = await login('ChangedOwner','Changed-pass-456'); assert.equal(owner.status,200);
    let admin = await login('TestAdmin','Admin-pass-123');
    const users = await call('/api/admin/users','GET',null,admin);
    assert.equal(users.data.users.length,2);assert(!JSON.stringify(users.data).includes('password'));
    assert.equal((await call('/api/admin/users/1','PATCH',{username:'Forbidden',currentPassword:'Changed-pass-456'},owner)).status,403);
    assert.equal((await call('/api/admin/users/1','PATCH',{password:'Reset-pass-789',currentPassword:'wrong'},admin)).status,400);
    assert.equal((await call('/api/admin/users/1','PATCH',{password:'Reset-pass-789',currentPassword:'Admin-pass-123'},admin)).status,200);
    assert.equal((await call('/api/me','GET',null,owner)).status,401);
    assert.equal((await login('ChangedOwner','Changed-pass-456')).status,401);
    owner = await login('ChangedOwner','Reset-pass-789'); assert.equal(owner.status,200);
    assert.equal((await call('/api/admin/users/1','PATCH',{disabled:true,currentPassword:'Admin-pass-123'},admin)).status,200);
    assert.equal((await call('/api/me','GET',null,owner)).status,401);
    assert.equal((await login('ChangedOwner','Reset-pass-789')).status,401);
    assert.equal((await call('/api/admin/users/1','PATCH',{disabled:false,currentPassword:'Admin-pass-123'},admin)).status,200);
    owner = await login('ChangedOwner','Reset-pass-789'); assert.equal(owner.status,200);
    assert.equal((await call('/api/admin/users/2','PATCH',{disabled:true,currentPassword:'Admin-pass-123'},admin)).status,403);
    const activity = await call('/api/admin/activity','GET',null,admin);
    assert(activity.data.activity.some(e=>e.action==='Admin updated account'));
    assert(!JSON.stringify(activity.data).includes('pass-'));
    admin = await call('/api/account','PATCH',{username:'ChangedAdmin',password:'New-admin-456',currentPassword:'Admin-pass-123'},admin);
    assert.equal(admin.status,200); assert.equal(admin.data.user.role,'admin');
    assert.equal((await call('/api/logout','POST',{},admin)).status,200);
    assert.equal((await call('/api/admin/users','GET',null,admin)).status,401);
    db.prepare('UPDATE sessions SET expires_at=0').run();
    assert.equal((await call('/api/me','GET',null,owner)).status,401);
    for(let i=0;i<10;i++) assert.equal((await login('Unknown','nope')).status,401);
    assert.equal((await login('Unknown','nope')).status,429);
    assert(!db.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash.includes('Reset-pass-789'));
    const reopened = openDatabase(dbPath);
    assert.equal(reopened.prepare('SELECT username FROM users WHERE id=1').get().username,'ChangedOwner');reopened.close();
  } finally {await new Promise(resolve=>app.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('production origin requires HTTPS',()=>{
 const dir=mkdtempSync(join(tmpdir(),'kirtle-origin-')); const db=openDatabase(join(dir,'accounts.sqlite'));
 try {assert.throws(()=>createApp({db,origin:'http://business.example'}),/HTTPS/);}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
