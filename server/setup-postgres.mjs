// Supply DATABASE_URL privately and JSON account credentials on stdin.
import postgres from 'postgres';
import {postgresDatabase} from './postgres.mjs';
import {createAccount} from './accounts.mjs';
const url=process.env.DATABASE_URL;
if(!url) throw Error('Set DATABASE_URL privately to the Supabase database connection string.');
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.length>10000)throw Error('Input too large.');}
const accounts=JSON.parse(input);
if(!Array.isArray(accounts)||!accounts.some(account=>account.role==='admin'))throw Error('Include an administrator.');
const database=postgresDatabase(postgres(url,{ssl:'require',max:1,prepare:false,connect_timeout:10}));
try {
  await database.withConnection(async db=>{
    await db.exec('BEGIN');
    try {
      if((await db.prepare('SELECT count(*) AS count FROM users').get()).count)throw Error('Accounts already exist. Setup never overwrites them.');
      for(const account of accounts)await createAccount(db,account.username,account.password,account.role);
      await db.exec('COMMIT');
      console.log('Accounts created. Passwords were hashed and are not displayed.');
    }catch(error){await db.exec('ROLLBACK');throw error;}
  });
}finally{await database.close();}
