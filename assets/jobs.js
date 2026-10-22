(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const rooms={beds:'Bedrooms',baths:'Bathrooms',kitchens:'Kitchens',living:'Living / family rooms',dining:'Dining rooms',offices:'Offices',basements:'Finished basements',other:'Other rooms'};
  const extras={baseboards:'Baseboards',fridge:'Interior fridge',freezer:'Freezer',blinds:'Blinds',linen:'Linen changes',laundry:'Laundry loads',upholstery:'Upholstery items'};
  let api,status,user,jobs=[],active=null,epoch=0;
  const noteDrafts=new Map();
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const name=j=>(j.source==='square'&&!j.work.scopeApproved?j.external.name:'')||j.work.name||j.intake.name||j.external.name||'Client details needed';
  const address=j=>(j.source==='square'&&!j.work.scopeApproved?j.external.address:'')||j.work.address||j.intake.address||j.external.address||'';
  const when=j=>j.source==='square'?j.external.startAt:j.work.startAt||j.intake.startAt;
  const dateText=value=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value)):'Time needed';
  const isCancelled=j=>['CANCELLED_BY_SELLER','CANCELLED_BY_CUSTOMER','DECLINED','NO_SHOW'].includes(j.external.status)||j.work.stage==='cancelled';
  const state=j=>isCancelled(j)?'Cancelled / unavailable':({needs_review:'Needs review',ready:'Ready to clean',in_progress:'Cleaning in progress',completed:'Completed'}[j.work.stage]||'Needs review');
  const easternDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  function showJobs(){
    $('jobs-panel').hidden=false;$('account-panel').hidden=true;$('admin-panel').hidden=true;
    for(const id of ['jobs','account','admin'])$(id+'-tab').setAttribute('aria-pressed',String(id==='jobs'));
  }
  function updateInList(job){jobs=jobs.map(j=>j.id===job.id?job:j);active=job;renderList();renderDetail();}
  function renderList(){
    const term=$('job-search').value.toLowerCase(),filter=$('job-filter').value,today=easternDay(Date.now());
    const visible=jobs.filter(j=>{
      const day=when(j)?easternDay(when(j)):'';
      if(filter==='today'&&day!==today)return false;
      if(filter==='review'&&(j.work.stage!=='needs_review'||isCancelled(j)))return false;
      if(filter==='completed'&&j.work.stage!=='completed')return false;
      if(filter==='upcoming'&&(isCancelled(j)||j.work.stage==='completed'||(!['needs_review','in_progress','ready'].includes(j.work.stage)&&day<today)))return false;
      return [name(j),address(j),j.intake.email,j.external.email,j.intake.phone,j.external.phone,j.intake.bookingReference,j.squareId,j.id].join(' ').toLowerCase().includes(term);
    }).sort((a,b)=>(Date.parse(when(a))||0)-(Date.parse(when(b))||0));
    $('job-list').replaceChildren();
    if(!visible.length)$('job-list').append(el('p','No visits match this view. New cleaning requests appear here when clients submit their details.','notice'));
    for(const job of visible){
      const button=el('button',undefined,'job-card');button.type='button';button.setAttribute('aria-pressed',String(active?.id===job.id));
      button.append(el('span',state(job),'tag'),el('h3',name(job)),el('p',dateText(when(job))),el('p',address(job)||'Service address needs confirmation','note'),el('span',`${job.tasks.filter(t=>t.done).length} / ${job.tasks.length} tasks · ${job.source==='square'?'Square appointment':'Website request'}`,'note'));
      button.addEventListener('click',()=>{active=job;renderList();renderDetail();$('job-detail').scrollIntoView({behavior:'smooth',block:'start'});});$('job-list').append(button);
    }
  }
  function detailLine(parent,label,value){if(!value)return;const p=el('p');p.append(el('strong',label+': '),document.createTextNode(value));parent.append(p);}
  function input(form,id,label,value='',type='text',required=false){
    const wrapper=el('label',label),control=el('input');control.id=id;control.name=id;control.type=type;control.value=value;control.required=required;control.maxLength=type==='text'?500:254;wrapper.append(control);form.append(wrapper);return control;
  }
  function select(form,id,label,values,value){const wrapper=el('label',label),control=el('select');control.id=id;control.required=true;for(const [key,label]of values){const option=el('option',label);option.value=key;control.append(option);}control.value=value;wrapper.append(control);form.append(wrapper);return control;}
  async function mutate(suffix,data){
    const id=active.id,generation=epoch;
    const result=await api('/api/jobs/'+id+suffix,'PATCH',{revision:active.revision,...data});
    if(generation!==epoch)return;
    updateInList(result.job);status('Saved to the appointment.');
  }
  function renderDetail(){
    const container=$('job-detail');container.replaceChildren();container.hidden=!active;if(!active)return;
    const j=active;container.append(el('span',state(j),'tag'),el('h2',name(j)),el('p',dateText(when(j)),'lead'));
    const info=el('div',undefined,'visit-info');
    detailLine(info,'Service address',address(j)||'Needs confirmation');
    detailLine(info,'Phone',j.work.phone||j.intake.phone||j.external.phone);
    detailLine(info,'Email',j.work.email||j.intake.email||j.external.email);
    detailLine(info,'Service',j.external.service||(j.intake.service?(j.intake.service==='detailed'?'Detailed clean':'Standard clean'):'Scope needs confirmation'));
    detailLine(info,'Square status',j.external.status);
    if(j.source==='square'){detailLine(info,'Latest Square client',[j.external.name,j.external.email,j.external.phone].filter(Boolean).join(' · '));detailLine(info,'Latest Square service address',j.external.address||'Not provided');}
    if(j.work.squareChanged)info.append(el('p','Square has changed since the plan was reviewed. Compare the latest Square client, address, date, and notes with the saved questionnaire before approving this visit again.','notice'));detailLine(info,'Booking reference',j.squareId||j.intake.bookingReference||j.id);
    detailLine(info,'Square visit length',j.external.durationMinutes?j.external.durationMinutes+' minutes':'');
    detailLine(info,'Requested frequency',j.intake.frequency);detailLine(info,'Home size / condition',[j.intake.size,j.intake.condition,j.intake.property].filter(Boolean).join(' · '));
    detailLine(info,'Client estimate (not a verified charge)',j.intake.estimate);detailLine(info,'Planning duration',j.intake.duration);
    detailLine(info,'Contact preference',j.intake.contactMethod);
    if(j.intake.startAt)detailLine(info,'Originally requested visit',dateText(j.intake.startAt));
    if(j.intake.rooms)detailLine(info,'Originally requested rooms',Object.entries(rooms).filter(([key])=>j.intake.rooms[key]).map(([key,label])=>label+' × '+j.intake.rooms[key]).join(', '));
    if(j.intake.extras)detailLine(info,'Originally requested extras',Object.entries(extras).filter(([key])=>j.intake.extras[key]).map(([key,label])=>label+' × '+j.intake.extras[key]).join(', ')||'None');
    if(j.intake.firstClean)detailLine(info,'Offer requested','First clean discount — confirm eligibility and final price.');
    detailLine(info,'Square profile address — verify before use',j.external.customerAddress);
    container.append(info);
    const requests=el('section',undefined,'client-instructions');requests.append(el('h3','Read before arrival'));
    detailLine(requests,'Client requests / rooms to skip',j.intake.notes||'No additional website requests provided.');
    detailLine(requests,'Pets, allergies & products',j.intake.pets||'Not provided — confirm with client.');
    detailLine(requests,'Parking & arrival',j.intake.arrival||'Not provided — confirm with client.');
    detailLine(requests,'Square client notes',j.external.customerNote);detailLine(requests,'Square staff notes',j.external.sellerNote);detailLine(requests,'Square profile notes',j.external.customerProfileNote);
    detailLine(requests,'Photo permission',j.intake.photoConsent==='granted'?'Granted in the submitted release; verify it has not been revoked.':'Not granted / not recorded. Do not take promotional photos.');
    if(j.intake.signature)detailLine(requests,'Release signed',j.intake.signature+' · '+j.intake.signatureDate);
    if(j.intake.releaseTerms){const release=el('details');release.append(el('summary','Submitted photo release'),el('p',j.intake.releaseTerms));requests.append(release);}
    for(const warning of j.external.missing||[])requests.append(el('p',warning,'notice'));
    container.append(requests);
    if(isCancelled(j))container.append(el('p','This visit is cancelled or unavailable. Cleaning actions are disabled.','notice'));
    if(j.work.stage==='needs_review')container.append(el('p','Confirm the client, service address, rooms, extras, and instructions below before starting. Imported Square notes do not automatically become cleaning tasks.','notice'));
    if(j.source==='square'&&!j.intake.name&&!isCancelled(j)&&!['in_progress','completed'].includes(j.work.stage))renderLink(container);
    if(!isCancelled(j)&&j.work.stage!=='completed')renderReview(container);
    const approved=j.work.scope||j.intake;
    if(approved.rooms)detailLine(container,'Approved rooms / scope',Object.entries(rooms).filter(([key])=>approved.rooms[key]).map(([key,label])=>label+' × '+approved.rooms[key]).join(', '));
    container.append(el('h3','Your cleaning order'),el('p',`${j.tasks.filter(t=>t.done).length} of ${j.tasks.length} items checked off. Checkmarks save to this visit and are shared with the administrator.`,'note'));
    if(!j.tasks.length)container.append(el('p','Add the cleaning scope in “Review cleaning plan” to generate the ordered checklist.','notice'));
    let section;
    for(const task of j.tasks){
      if(task.section!==section){section=task.section;container.append(el('h3',section,'task-section'));}
      const label=el('label',undefined,'task-check'),check=el('input');check.type='checkbox';check.checked=task.done;check.dataset.task=task.id;
      check.disabled=isCancelled(j)||!j.work.scopeApproved||j.work.stage==='completed'||j.work.stage==='needs_review'||(j.source==='square'&&j.external.status!=='ACCEPTED');
      const text=el('span',task.label);if(task.done)text.append(el('small',`Saved by ${task.completedBy} · ${new Date(task.completedAt).toLocaleString()}`));label.append(check,text);container.append(label);
      check.addEventListener('change',async()=>{
        container.querySelectorAll('.task-check input').forEach(c=>c.disabled=true);
        try{await mutate('',{action:'task',taskId:task.id,done:check.checked});container.querySelector(`[data-task="${task.id}"]`)?.focus({preventScroll:true});}
        catch(e){status(e.message,true);renderDetail();}
      });
    }
    const notes=el('form',undefined,'work-notes');notes.append(el('h3','Work notes & follow-up'));
    const label=el('label','Record changes, access issues, or work needing follow-up'),textarea=el('textarea');textarea.value=noteDrafts.get(j.id)??j.work.staffNotes??'';textarea.addEventListener('input',()=>{if(textarea.value===(j.work.staffNotes||''))noteDrafts.delete(j.id);else noteDrafts.set(j.id,textarea.value);});textarea.maxLength=4000;textarea.id='work-notes';label.append(textarea);notes.append(label);
    const save=el('button','Save work notes','btn secondary');save.type='submit';notes.append(save);
    notes.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await mutate('',{action:'note',notes:textarea.value});noteDrafts.delete(j.id);}catch(e){save.disabled=false;status(e.message,true);}});container.append(notes);
    if(!isCancelled(j)&&j.work.stage!=='completed'){
      const finish=el('button','Mark cleaning complete','btn');finish.type='button';finish.disabled=!j.tasks.length||!j.tasks.every(t=>t.done)||!j.work.scopeApproved;
      finish.addEventListener('click',async()=>{finish.disabled=true;try{await mutate('',{action:'complete'});}catch(e){finish.disabled=false;status(e.message,true);}});container.append(finish);
      if(j.source==='website'){
        const cancel=el('button','Cancel this website request','text-button cancel-visit');cancel.type='button';
        cancel.addEventListener('click',async()=>{if(!window.confirm('Cancel this cleaning request? This will stop checklist changes.'))return;try{await mutate('',{action:'cancel'});}catch(e){status(e.message,true);}});container.append(cancel);
      }
    }
    if(j.work.completedAt)detailLine(container,'Completed',dateText(new Date(j.work.completedAt).toISOString())+' · '+j.work.completedBy);
  }
  function renderReview(container){
    const j=active,details=el('details',undefined,'plan-review');details.open=j.work.stage==='needs_review';details.append(el('summary','Review cleaning plan'));
    const form=el('form'),grid=el('div',undefined,'scope-grid');const selected=j.work.scope||j.intake;
    input(grid,'review-name','Client name',name(j)==='Client details needed'?'':name(j),'text',true);
    input(grid,'review-phone','Client phone',j.work.phone||j.intake.phone||j.external.phone||'','tel',true);
    input(grid,'review-email','Client email',j.work.email||j.intake.email||j.external.email||'','email');
    input(grid,'review-address','Confirmed service address',address(j),'text',true);
    if(j.source==='website'){
      const source=j.work.startAt||j.intake.startAt;const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(source)).map(p=>[p.type,p.value]));
      input(grid,'review-date','Agreed date (Eastern)',`${p.year}-${p.month}-${p.day}`,'date',true);input(grid,'review-time','Agreed time (Eastern)',`${p.hour}:${p.minute}`,'time',true);
    }else form.append(el('p','Appointment time and cancellation status come from Square. Make schedule changes in Square and sync here.','note'));
    select(grid,'review-service','Cleaning level',[['','Choose service'],['standard','Standard clean'],['detailed','Detailed clean']],selected.service||'');
    form.append(grid,el('h4','Rooms included — adjust for any rooms to skip'));
    const roomGrid=el('div',undefined,'scope-grid');
    for(const [key,label]of Object.entries(rooms)){const control=input(roomGrid,'review-room-'+key,label,selected.rooms?.[key]||0,'number',true);control.min=0;control.max=15;control.step=key==='baths'?0.5:1;}
    form.append(roomGrid,el('h4','Agreed add-ons — zero means not included'));
    const extraGrid=el('div',undefined,'scope-grid');
    for(const [key,label]of Object.entries(extras)){const control=input(extraGrid,'review-extra-'+key,label,selected.extras?.[key]||0,'number',true);control.min=0;control.max=20;control.step=1;}
    form.append(extraGrid);
    const label=el('label','Cleaner instructions / work notes'),notes=el('textarea');notes.id='review-notes';notes.maxLength=4000;notes.value=j.work.staffNotes||'';label.append(notes);form.append(label);
    const agreeLabel=el('label',undefined,'check-label'),agree=el('input');agree.type='checkbox';agree.required=true;agree.id='review-agree';agreeLabel.append(agree,document.createTextNode('I confirmed this client, service address, appointment, and cleaning scope, including exclusions and special requests.'));form.append(agreeLabel);
    const submit=el('button','Save approved cleaning plan','btn');submit.type='submit';form.append(submit);
    form.addEventListener('submit',async e=>{
      e.preventDefault();submit.disabled=true;
      const data={approved:agree.checked,name:$('review-name').value,email:$('review-email').value,phone:$('review-phone').value,address:$('review-address').value,date:$('review-date')?.value,time:$('review-time')?.value,service:$('review-service').value,rooms:Object.fromEntries(Object.keys(rooms).map(k=>[k,Number($('review-room-'+k).value)])),extras:Object.fromEntries(Object.keys(extras).map(k=>[k,Number($('review-extra-'+k).value)])),staffNotes:notes.value};
      try{await mutate('/review',data);}catch(e){submit.disabled=false;status(e.message,true);}
    });details.append(form);container.append(details);
  }
  function renderLink(container){
    const available=jobs.filter(j=>j.source==='website'&&!j.linkedTo&&!isCancelled(j)&&!['completed','in_progress'].includes(j.work.stage));
    if(!available.length)return;
    const details=el('details',undefined,'plan-review');details.append(el('summary','Attach the matching client questionnaire'));
    const form=el('form'),choices=[['','Select the correct client and visit'],...available.map(j=>[j.id,`${name(j)} · ${dateText(when(j))} · ${address(j)} · ${j.intake.email}`])];
    const selected=select(form,'link-request','Saved intake',choices,'');
    form.append(el('p','Compare the client name, address, contact details, and appointment date before linking. The intake is kept on this Square visit and removed from the separate request list.','note'));
    const agreeLabel=el('label',undefined,'check-label'),agree=el('input');agree.type='checkbox';agree.required=true;agreeLabel.append(agree,document.createTextNode('These records belong to the same client and visit.'));form.append(agreeLabel);
    const button=el('button','Attach intake','btn secondary');button.type='submit';form.append(button);
    form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;const request=available.find(j=>j.id===selected.value);try{await mutate('/link',{requestId:request.id,requestRevision:request.revision,confirmed:agree.checked});await load();}catch(e){button.disabled=false;status(e.message,true);}});
    details.append(form);container.append(details);
  }
  async function load(){
    const generation=epoch;const [result,square]=await Promise.all([api('/api/jobs'),api('/api/square/status')]);if(generation!==epoch)return;
    jobs=result.jobs;
    $('square-status').textContent=square.configured?`${square.environment==='sandbox'?'Square sandbox':'Square'} · ${square.lastSuccess?'Last synced '+dateText(new Date(square.lastSuccess).toISOString()):'Waiting for first sync'}. ${square.lastError||'Syncs every 5 minutes while the server is running.'}`:'Square is not connected yet. Website cleaning requests are saved here now.';
    $('sync-square').disabled=!square.configured;
    if(active){active=jobs.find(j=>j.id===active.id)||null;renderDetail();}renderList();
  }
  $('jobs-tab').addEventListener('click',()=>{showJobs();load().catch(e=>status(e.message,true));});
  $('refresh-jobs').addEventListener('click',()=>load().then(()=>status('Visits refreshed.')).catch(e=>status(e.message,true)));
  $('sync-square').addEventListener('click',async()=>{const b=$('sync-square');b.disabled=true;status('Syncing appointments from Square…');try{await api('/api/square/sync','POST',{});await load();status('Square appointments are up to date.');}catch(e){status(e.message,true);b.disabled=false;}});
  $('job-filter').addEventListener('change',renderList);$('job-search').addEventListener('input',renderList);
  window.addEventListener('beforeunload',event=>{if(noteDrafts.size){event.preventDefault();event.returnValue='';}});
  window.addEventListener('kirtle-signed-in',event=>{epoch++;({api,status,user}=event.detail);active=null;showJobs();load().catch(e=>status(e.message,true));});
  window.addEventListener('kirtle-signed-out',()=>{epoch++;jobs=[];active=null;noteDrafts.clear();$('job-list').replaceChildren();$('job-detail').replaceChildren();$('job-detail').hidden=true;$('square-status').textContent='';});
})();
