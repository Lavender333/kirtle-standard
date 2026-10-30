import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {connectionDatabase} from '../server/postgres.mjs';
import {createFetchHandler} from '../server/edge.mjs';
import {createAccount} from '../server/accounts.mjs';
import {getJob,createRequest,reviewJob,updateJob,linkRequest,importSquare,listJobs} from '../server/jobs.mjs';
const origin='https://kirtlecleans.com';
const intake=()=>({submissionKey:randomUUID(),name:'Test Client',email:'client@example.test',phone:'216-555-0100',address:'123 Test Lane',date:'2035-05-10',time:'09:00',service:'standard',rooms:{beds:1,baths:1,kitchens:1},extras:{},notes:'Skip study',acknowledged:true,photoConsent:'declined'});
const plan=job=>({...job.intake,revision:job.revision,approved:true,staffNotes:'Agreed scope'});
async function fixture(){
  const pg=new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261029205300_kirtle_private_backend.sql',import.meta.url),'utf8'));
  const db=connectionDatabase(async (sql,args)=>{
    const result=await pg.query(sql,args);return {rows:result.rows,count:result.affectedRows};
  });
  let pending=Promise.resolve();
  const database={withConnection(action){const current=pending.then(()=>action(db));pending=current.catch(()=>{});return current;}};
  const handler=createFetchHandler({database,origins:[origin]});
  async function call(path,method='GET',data,session,extraHeaders={}) {
    const response=await handler(new Request('https://example.supabase.co/functions/v1/kirtle-api'+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.sessionToken,'X-CSRF-Token':session.csrf}:{}),...extraHeaders},...(data?{body:JSON.stringify(data)}:{})}));
    return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
  }
  return {pg,db,call,close:()=>pg.close()};
}

test('Supabase edge: private schema, intake, accounts, checklists, revocation and CORS',async()=>{
  const {pg,db,call,close}=await fixture();
  try {
    assert.equal((await call('/api/health')).status,200);
    const rows=(await pg.query("SELECT relname,relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kirtle_private' AND relkind='r'")).rows;
    assert.equal(rows.length,6);assert(rows.every(row=>row.relrowsecurity));
    await pg.exec('SET ROLE anon');
    await assert.rejects(pg.query('SELECT * FROM kirtle_private.jobs'),/permission denied/);
    await pg.exec('RESET ROLE');
    assert.equal((await call('/api/jobs')).status,401);
    assert.equal((await call('/api/requests','POST',intake(),null,{Origin:'https://evil.test'})).status,403);
    assert.equal((await call('/api/requests','POST',intake(),null,{Origin:''})).status,403);
    assert.equal((await call('/api/requests','OPTIONS')).status,204);
    assert.equal((await call('/api/requests','POST',{...intake(),rooms:{beds:-1}})).status,400);
    const data=intake(),saved=await call('/api/requests','POST',data);
    assert.equal(saved.status,201);assert(!JSON.stringify(saved.data).includes('Test Lane'));
    assert.equal((await call('/api/requests','POST',data)).data.reference,saved.data.reference);
    assert.equal((await call('/api/requests','POST',{...data,notes:'changed'})).status,409);
    await createAccount(db,'Admin','Admin-example-123','admin');
    await createAccount(db,'Owner','Owner-example-123','owner');
    const login=await call('/api/login','POST',{username:'owner',password:'Owner-example-123'});
    assert.equal(login.status,200);assert(login.data.sessionToken);assert(!login.headers.has('set-cookie'));
    assert.equal(login.headers.get('access-control-allow-origin'),origin);
    const owner=login.data;
    assert.equal((await call('/api/admin/users','GET',null,owner)).status,403);
    let job=(await call('/api/jobs','GET',null,owner)).data.jobs[0];
    assert.equal(job.intake.address,data.address);
    job=(await call('/api/jobs/'+job.id+'/review','PATCH',plan(job),owner)).data.job;
    assert.equal(job.work.stage,'ready');
    assert.equal((await call('/api/jobs/'+job.id,'PATCH',{revision:job.revision,action:'task',taskId:job.tasks[0].id,done:true},owner,{'X-CSRF-Token':'wrong'})).status,403);
    const oldRevision=job.revision;
    job=(await call('/api/jobs/'+job.id,'PATCH',{revision:job.revision,action:'task',taskId:job.tasks[0].id,done:true},owner)).data.job;
    assert.equal(job.tasks[0].completedBy,'Owner');
    assert.equal((await call('/api/jobs/'+job.id,'PATCH',{revision:oldRevision,action:'note',notes:'stale'},owner)).status,409);
    const admin=(await call('/api/login','POST',{username:'Admin',password:'Admin-example-123'})).data;
    const ownerId=(await call('/api/admin/users','GET',null,admin)).data.users.find(user=>user.role==='owner').id;
    assert((await call('/api/admin/activity','GET',null,admin)).data.activity.every(event=>typeof event.createdAt==='number'));
    assert.equal((await call('/api/admin/users/'+ownerId,'PATCH',{disabled:true,currentPassword:'Admin-example-123'},admin)).status,200);
    assert.equal((await call('/api/me','GET',null,owner)).status,401);
    assert.equal((await call('/api/login','POST',{username:'Owner',password:'Owner-example-123'})).status,401);
    assert.equal((await call('/api/admin/users/'+ownerId,'PATCH',{disabled:false,password:'Owner-new-example-123',currentPassword:'Admin-example-123'},admin)).status,200);
    const newOwner=(await call('/api/login','POST',{username:'Owner',password:'Owner-new-example-123'})).data;
    const changed=await call('/api/account','PATCH',{username:'OwnerNew',password:'Owner-next-example-123',currentPassword:'Owner-new-example-123'},newOwner);
    assert.equal(changed.status,200);assert.equal((await call('/api/me','GET',null,newOwner)).status,401);
    assert.equal((await call('/api/me','GET',null,changed.data)).status,200);
    assert.equal((await call('/api/square/status','GET',null,admin)).data.configured,false);
    assert.equal((await call('/api/square/sync','POST',{},admin)).status,503);
    assert.equal((await call('/api/logout','POST',{},changed.data)).status,200);
    assert.equal((await call('/api/me','GET',null,changed.data)).status,401);
  } finally {await close();}
});

test('Postgres conflicting checklist writes preserve one winner; linking is atomic',async()=>{
  const {db,close}=await fixture();
  try {
    const id=await createRequest(db,intake());let job=await getJob(db,id);
    job=await reviewJob(db,id,plan(job),'Owner');
    const results=await Promise.allSettled([
      updateJob(db,id,{revision:job.revision,action:'note',notes:'first'},'Owner'),
      updateJob(db,id,{revision:job.revision,action:'note',notes:'second'},'Admin')
    ]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
    const requestId=await createRequest(db,intake());
    await importSquare(db,{id:'test-square',version:1,status:'ACCEPTED',startAt:'2035-05-10T13:00:00Z'});
    const square=(await listJobs(db)).find(job=>job.source==='square');
    const linked=await linkRequest(db,square.id,{revision:square.revision,requestId,requestRevision:1,confirmed:true},'Owner');
    assert.equal(linked.intake.name,'Test Client');assert.equal((await getJob(db,requestId)).linkedTo,square.id);
  } finally {await close();}
});

test('browser transport sends edge tokens, restores a tab session, and clears it on logout',async()=>{
  const {runInNewContext}=await import('node:vm');
  const {db,call,close}=await fixture();
  const storage=new Map();
  const sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const source=readFileSync(new URL('../assets/api.js',import.meta.url),'utf8');
  const requests=[];
  function browser(){
    const window={KIRTLE_API_BASE:'https://example.supabase.co/functions/v1/kirtle-api'};
    const fetch=async(url,options)=>{
      requests.push({url,options});
      const result=await call(new URL(url).pathname.replace('/functions/v1/kirtle-api',''),options.method||'GET',options.body?JSON.parse(options.body):undefined,null,Object.fromEntries(options.headers));
      return new Response(JSON.stringify(result.data),{status:result.status,headers:result.headers});
    };
    runInNewContext(source,{window,sessionStorage,Headers,fetch});return window.KirtleAPI;
  }
  try{
    await createAccount(db,'TransportAdmin','Transport-example-123','admin');
    const api=browser();
    const login=await api.fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'TransportAdmin',password:'Transport-example-123'})});
    assert.equal(login.status,200);const identity=await login.json();
    const reloaded=browser();assert.equal((await reloaded.fetch('/api/me')).status,200);
    assert.equal(requests.at(-1).options.credentials,'omit');
    assert.match(requests.at(-1).options.headers.get('Authorization'),/^Bearer [a-f0-9]{64}$/);
    await reloaded.fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':identity.csrf},body:'{}'});
    assert.equal(storage.size,0);assert.equal((await browser().fetch('/api/me')).status,401);
    await assert.rejects(api.fetch('https://evil.test/'),/Invalid/);
  }finally{await close();}
});
