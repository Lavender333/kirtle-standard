import {createHandler} from './handler.mjs';
import {createSquareSync} from './square.mjs';

// Shared Web Request handler, exercised against real Postgres in the test suite.
export function createFetchHandler({database, origins, squareOptions={}}) {
  const allowed = new Set(origins);
  if (!allowed.size || [...allowed].some(origin => new URL(origin).origin !== origin || !origin.startsWith('https://'))) {
    throw Error('Configure exact HTTPS origins for the public website.');
  }
  return async request => {
    const origin = request.headers.get('origin');
    const headers = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
    if (origin && allowed.has(origin)) {
      headers.set('Access-Control-Allow-Origin',origin);
      headers.set('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
      headers.set('Access-Control-Allow-Headers','authorization, content-type, x-csrf-token');
      headers.set('Access-Control-Max-Age','600');
    }
    const error = (status,message) => new Response(JSON.stringify({error:message}),{status,headers});
    if (origin && !allowed.has(origin)) return error(403,'Please use the Kirtle Standard website.');
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (!['GET','HEAD'].includes(request.method) && !allowed.has(origin)) return error(403,'Please use the Kirtle Standard website.');
    const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/kirtle-api(?=\/|$)/,'').replace(/^\/kirtle-api(?=\/|$)/,'');
    if (!path.startsWith('/api/')) return error(404,'Not found.');
    if (Number(request.headers.get('content-length') || 0) > 32768) return error(413,'Request is too large.');
    try {
      return await database.withConnection(async db => {
        const siteOrigin = origin || [...allowed][0];
        const square = createSquareSync(db,squareOptions);
        const handler = createHandler({db,origin:siteOrigin,square,bearer:true});
        // Never trust caller-supplied forwarding headers for security limits.
        // Public edge traffic shares the persistent IP bucket; per-account limits also apply.
        const req = {
          method:request.method,url:path,
          headers:{...Object.fromEntries(request.headers),host:new URL(siteOrigin).host},
          socket:{remoteAddress:'edge'},
          async *[Symbol.asyncIterator]() { if (request.body) for await (const chunk of request.body) yield chunk; }
        };
        let status=200,body;
        const res = {
          setHeader:(key,value)=>headers.set(key,value),
          writeHead:(code,values)=>{status=code;for(const [key,value] of Object.entries(values)) headers.set(key,value);},
          end:value=>{body=value;}
        };
        await handler(req,res);
        return new Response(request.method==='HEAD'?null:body,{status,headers});
      });
    } catch (error) {
      console.error('Backend unavailable:',error.code || error.name);
      return new Response(JSON.stringify({error:'The service is temporarily unavailable. Please try again or call (440) 728-4938.'}),{status:503,headers});
    }
  };
}
