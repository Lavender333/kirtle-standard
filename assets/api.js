(() => {
  'use strict';
  const base=window.KIRTLE_API_BASE || '';
  const storageKey='kirtle-session:' + base;
  let token='';
  try { token=sessionStorage.getItem(storageKey) || ''; } catch {}
  function save(value) {
    token=value || '';
    try { if(token) sessionStorage.setItem(storageKey,token); else sessionStorage.removeItem(storageKey); } catch {}
  }
  window.KirtleAPI={
    clear:()=>save(''),
    async fetch(path,options={}) {
      if(!/^\/api\//.test(path)) throw Error('Invalid service request.');
      const headers=new Headers(options.headers);
      if(base && token) headers.set('Authorization','Bearer '+token);
      const response=await fetch(base+path,{...options,headers,credentials:base?'omit':'same-origin',cache:'no-store'});
      if(base && response.ok && ['/api/login','/api/account'].includes(path)) {
        const result=await response.clone().json();
        if(result.sessionToken) save(result.sessionToken);
      }
      if((path==='/api/logout' && response.ok) || (response.status===401 && path!=='/api/login')) save('');
      return response;
    }
  };
})();
