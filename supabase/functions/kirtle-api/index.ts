import postgres from 'npm:postgres@3.4.7';
import {postgresDatabase} from '../../../server/postgres.mjs';
import {createFetchHandler} from '../../../server/edge.mjs';

const url = Deno.env.get('SUPABASE_DB_URL');
if (!url) throw Error('SUPABASE_DB_URL is required');
const sql = postgres(url,{prepare:false,max:2,idle_timeout:20,connect_timeout:10,ssl:'require'});
const origins = (Deno.env.get('KIRTLE_ALLOWED_ORIGINS') || 'https://kirtlecleans.com,https://www.kirtlecleans.com').split(',').map(value=>value.trim()).filter(Boolean);
Deno.serve(createFetchHandler({
  database:postgresDatabase(sql),origins,
  squareOptions:{token:Deno.env.get('SQUARE_ACCESS_TOKEN') || '',environment:Deno.env.get('SQUARE_ENVIRONMENT') || 'production',locationId:Deno.env.get('SQUARE_LOCATION_ID') || ''}
}));
