(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let user, csrf, managedId;
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function signedOut() {
    user = null; csrf = null; managedId = null;
    $('workspace').hidden = true; $('logout').hidden = true; $('login-view').hidden = false;
    $('admin-panel').hidden = true; $('admin-tab').hidden = true;
    $('users').replaceChildren(); $('activity').replaceChildren();
    document.querySelectorAll('form').forEach(f=>f.reset());
  }
  async function api(path, method = 'GET', data) {
    let response;
    try { response = await fetch(path, { method, credentials:'same-origin', cache:'no-store', headers: {
      'Content-Type':'application/json', ...(csrf ? {'X-CSRF-Token':csrf} : {})
    }, ...(data ? {body:JSON.stringify(data)} : {}) }); }
    catch { throw Error('Unable to connect. Check your connection and try again.'); }
    if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Account login needs the account service. Open the hosted dashboard or start the local account server.');
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/login') signedOut();
      throw Error(result.error || 'Unable to complete your request.');
    }
    return result;
  }
  function showAccount() {
    $('account-panel').hidden = false; $('admin-panel').hidden = true;
    $('account-tab').setAttribute('aria-pressed','true'); $('admin-tab').setAttribute('aria-pressed','false');
  }
  function signedIn(result) {
    user = result.user; csrf = result.csrf;
    $('login-view').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
    $('greeting').textContent = `Welcome, ${user.username}.`;
    $('role-label').textContent = user.role === 'admin' ? 'ADMINISTRATOR WORKSPACE' : 'OWNER WORKSPACE';
    $('admin-tab').hidden = user.role !== 'admin';
    $('account-form').reset(); $('account-username').value = user.username;
    $('login-form').reset(); showAccount();
  }
  function formTask(id, action) {
    $(id).addEventListener('submit', async event => {
      event.preventDefault(); const button = event.target.querySelector('[type=submit]'); button.disabled = true; status('');
      try { await action(); } catch(e) { status(e.message, true); }
      finally { button.disabled = false; }
    });
  }
  function passwordMatches(first, second) {
    if ($(first).value !== $(second).value) throw Error('The new passwords do not match.');
  }
  formTask('login-form',async()=>{
    signedIn(await api('/api/login','POST',{username:$('login-username').value.trim(),password:$('login-password').value}));
    status('You’re signed in.');
  });
  formTask('account-form',async()=>{
    passwordMatches('new-password','confirm-password');
    const data = { username:$('account-username').value.trim(), currentPassword:$('current-password').value };
    if ($('new-password').value) data.password = $('new-password').value;
    signedIn(await api('/api/account','PATCH',data));
    status('Your account has been updated. Your other sessions were signed out.');
  });
  $('logout').addEventListener('click',async()=>{
    try { await api('/api/logout','POST',{}); signedOut(); status('You’re logged out.'); }
    catch(e) { status(e.message,true); }
  });
  $('account-tab').addEventListener('click',()=>{showAccount();status('');});
  async function loadAdmin() {
    const [accounts, events] = await Promise.all([api('/api/admin/users'), api('/api/admin/activity')]);
    $('users').replaceChildren();
    for (const account of accounts.users) {
      const row=document.createElement('tr');
      for(const value of [account.username, account.role==='admin'?'Administrator':'Owner',account.disabled?'Disabled':'Active']) {
        const cell=document.createElement('td');cell.textContent=value;row.append(cell);
      }
      const cell=document.createElement('td'),button=document.createElement('button');
      button.className='text-button';button.type='button';
      button.textContent=account.id===user.id?'My account':account.role==='admin'?'Administrator':'Manage';
      button.disabled=account.role==='admin' && account.id!==user.id;
      button.addEventListener('click',()=>{
        if(account.id===user.id){showAccount();return;}
        managedId=account.id;$('manage-form').reset();$('manage-title').textContent=`Manage ${account.username}`;
        $('manage-username').value=account.username;$('manage-disabled').checked=account.disabled;
        $('manage-form').hidden=false;$('manage-username').focus();
      });
      cell.append(button);row.append(cell);$('users').append(row);
    }
    $('activity').replaceChildren();
    for(const entry of events.activity){
      const li=document.createElement('li'),time=document.createElement('time');
      li.textContent=`${entry.actor} · ${entry.action} · ${entry.target}`;
      time.dateTime=new Date(entry.createdAt).toISOString();time.textContent=new Date(entry.createdAt).toLocaleString();
      li.append(time);$('activity').append(li);
    }
  }
  $('admin-tab').addEventListener('click',async()=>{
    try {
      await loadAdmin();$('account-panel').hidden=true;$('admin-panel').hidden=false;$('manage-form').hidden=true;
      $('account-tab').setAttribute('aria-pressed','false');$('admin-tab').setAttribute('aria-pressed','true');status('');
    }catch(e){status(e.message,true);}
  });
  $('cancel-manage').addEventListener('click',()=>{$('manage-form').hidden=true;$('manage-form').reset();managedId=null;});
  formTask('manage-form',async()=>{
    passwordMatches('manage-password','manage-confirm');
    const data={username:$('manage-username').value.trim(),disabled:$('manage-disabled').checked,currentPassword:$('admin-password').value};
    if($('manage-password').value)data.password=$('manage-password').value;
    await api(`/api/admin/users/${managedId}`,'PATCH',data);
    $('manage-form').hidden=true;$('manage-form').reset();managedId=null;
    await loadAdmin();status('Account updated. The user’s existing sessions have been signed out.');
  });
  api('/api/me').then(signedIn).catch(e=>{if(e.message!=='Please log in to continue.')status(e.message,true);});
  // Revalidate when returning from another tab; protected APIs always check the server session.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && user)api('/api/me').catch(e=>status(e.message,true));});
})();
