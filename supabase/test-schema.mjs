// Run with an installed PGlite module path; all data is in a disposable database.
// node supabase/test-schema.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.argv[2]) throw Error('Pass the path to an installed @electric-sql/pglite module.');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid;
    $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
  `);
  await db.exec(await readFile(new URL('./migrations/202610220001_managed_dashboard.sql', import.meta.url),'utf8'));
  const owner='00000000-0000-0000-0000-000000000001';
  const admin='00000000-0000-0000-0000-000000000002';
  const disabled='00000000-0000-0000-0000-000000000003';
  const outsider='00000000-0000-0000-0000-000000000004';
  const job='00000000-0000-0000-0000-000000000005';
  await db.exec(`
    insert into auth.users values ('${owner}'),('${admin}'),('${disabled}'),('${outsider}');
    insert into public.kirtle_profiles(id,username,role,disabled) values
      ('${owner}','FixtureOwner','owner',false),('${admin}','FixtureAdmin','admin',false),
      ('${disabled}','FixtureDisabled','owner',true);
    insert into public.kirtle_jobs(id,source,intake) values ('${job}','website','{"name":"Fixture Client"}');
    insert into public.kirtle_activity(actor,action,target) values ('FixtureAdmin','Fixture event','fixture');
  `);
  async function as(role,id=''){
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    await db.exec('set role '+role);
  }
  const count=async table=>(await db.query('select count(*)::int as n from public.'+table)).rows[0].n;
  await as('anon');
  await assert.rejects(()=>count('kirtle_jobs'),/permission denied/);
  await assert.rejects(()=>count('kirtle_profiles'),/permission denied/);
  await as('authenticated',owner);
  assert.equal(await count('kirtle_jobs'),1);assert.equal(await count('kirtle_profiles'),1);
  assert.equal(await count('kirtle_activity'),0);
  await assert.rejects(()=>db.exec("update public.kirtle_profiles set role='admin'"),/permission denied/);
  await assert.rejects(()=>db.exec("update public.kirtle_jobs set tasks='[]'"),/permission denied/);
  await assert.rejects(()=>db.query('select public.kirtle_save_job($1,1,$2,$3,$4,$5)',[job,{},[],owner,'Changed work']),/permission denied/);
  await as('authenticated',admin);
  assert.equal(await count('kirtle_profiles'),3);assert.equal(await count('kirtle_activity'),1);
  await as('authenticated',disabled);
  assert.equal(await count('kirtle_jobs'),0);assert.equal(await count('kirtle_profiles'),0);
  await as('authenticated',outsider);assert.equal(await count('kirtle_jobs'),0);
  await as('service_role');
  await db.query('select public.kirtle_save_job($1,1,$2,$3,$4,$5)',[job,{stage:'in_progress'},[{id:'fixture-task',done:true}],owner,'Changed work']);
  assert.equal((await db.query('select revision from public.kirtle_jobs where id=$1',[job])).rows[0].revision,2);
  assert.equal(await count('kirtle_activity'),2);
  await assert.rejects(()=>db.query('select public.kirtle_save_job($1,1,$2,$3,$4,$5)',[job,{},[],owner,'Stale write']),/Appointment changed/);
  await assert.rejects(()=>db.query('select public.kirtle_save_job($1,2,$2,$3,$4,$5)',[job,{},[],disabled,'Disabled write']),/not active/);
  assert.equal(await count('kirtle_activity'),2);
  console.log('PASS: SQL migration, anonymous denial, owner/admin isolation, disabled/unknown staff denial, no browser writes, atomic revision save and audit.');
} finally { await db.close(); }
