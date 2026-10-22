import { randomUUID, createHash } from 'node:crypto';
export function problem(status,message){throw Object.assign(new Error(message),{status});}
export const roomNames={beds:'Bedrooms',baths:'Bathrooms',kitchens:'Kitchens',living:'Living / family rooms',dining:'Dining rooms',offices:'Offices',basements:'Finished basements',other:'Other rooms'};
export const extraNames={baseboards:'Hand-wipe baseboards',fridge:'Clean interior fridge',freezer:'Clean freezer',blinds:'Detail-clean blinds',linen:'Change bed linens',laundry:'Wash and finish laundry',upholstery:'Vacuum upholstery'};
const hash=value=>createHash('sha256').update(value).digest('hex');
function text(value,max=2000,required=false){if(value===undefined&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))problem(400,'Please complete the required details within the allowed length.');return value.trim();}
export function easternTime(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))problem(400,'Choose a valid date and time.');
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const options=[4,5].map(offset=>new Date(`${date}T${time}:00-${String(offset).padStart(2,'0')}:00`)).filter(d=>!isNaN(d)&&(()=>{const p=Object.fromEntries(formatter.formatToParts(d).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`===date&&`${p.hour}:${p.minute}`===time;})());
  if(options.length!==1)problem(400,'Choose another time; this time is invalid or ambiguous because of daylight saving time.');
  return options[0].toISOString();
}
export function scope(data){
  if(!['standard','detailed'].includes(data.service))problem(400,'Choose a cleaning service.');
  const rooms={},extras={};
  for(const key of Object.keys(roomNames)){const n=data.rooms?.[key]??0;if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>15||(key==='baths'?n*2%1:n%1))problem(400,'Check the room quantities.');rooms[key]=n;}
  if(!Object.values(rooms).some(Boolean))problem(400,'Select at least one room.');
  for(const key of Object.keys(extraNames)){const n=data.extras?.[key]??0;if(!Number.isInteger(n)||n<0||n>20)problem(400,'Check the add-on quantities.');extras[key]=n;}
  return {service:data.service,rooms,extras};
}
function normalizeIntake(data){
  const result={...scope(data),name:text(data.name,120,true),email:text(data.email,254,true),phone:text(data.phone,50,true),address:text(data.address,500,true),date:text(data.date,10,true),time:text(data.time,5,true),notes:text(data.notes),pets:text(data.pets),arrival:text(data.arrival),bookingReference:text(data.bookingReference,192),property:text(data.property,100),condition:text(data.condition,100),size:text(data.size,100),frequency:text(data.frequency,100),contactMethod:text(data.contactMethod,50)};
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))problem(400,'Enter a valid email address.');
  result.startAt=easternTime(result.date,result.time);
  if(Date.parse(result.startAt)<Date.now()-60000)problem(400,'Choose a future visit date and time.');
  if(data.acknowledged!==true)problem(400,'Please acknowledge your cleaning request.');
  result.acknowledged=true;result.firstClean=data.firstClean===true;
  result.photoConsent=data.photoConsent==='granted'?'granted':'declined';
  if(result.photoConsent==='granted'){
    if(data.releaseAcknowledged!==true)problem(400,'Please acknowledge the photo release.');
    result.releaseAcknowledged=true;result.signature=text(data.signature,120,true);result.signatureDate=text(data.signatureDate,10,true);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(result.signatureDate)||!Number.isFinite(Date.parse(result.signatureDate)))problem(400,'Enter a valid signature date.');
    result.releaseTerms=text(data.releaseTerms,8000,true);
  }
  // Submitted estimates are reference-only; never used to collect or mark a payment.
  result.estimate=text(data.estimate,200);result.duration=text(data.duration,200);
  return result;
}
export function makeChecklist(intake){
  if(!intake?.rooms)return [];
  const tasks=[];
  function add(section,label){tasks.push({id:hash(section+'|'+label).slice(0,20),section,label,done:false,completedAt:null,completedBy:null});}
  add('1. Arrival & preparation','Read the client’s requests, rooms to skip, pets, allergies, and product preferences. Confirm the agreed scope before starting.');
  add('1. Arrival & preparation','Walk through the property, note existing damage, and confirm safe access and suitable products for each surface. Do not mix cleaning products.');
  if(intake.extras.laundry)add('1. Arrival & preparation',`Start approved laundry (${intake.extras.laundry} load(s)); check care labels and client instructions.`);
  for(const [key,n] of Object.entries(intake.rooms)){if(!n)continue;
    add('2. High surfaces & dusting',`${roomNames[key]} × ${n}: dust accessible fixtures, vents, blinds, sills, furniture, and décor from high to low; wipe switches as appropriate.`);
  }
  if(intake.rooms.kitchens){const n=intake.rooms.kitchens;
    if(intake.service==='detailed')add('3. Kitchen',`Kitchens × ${n}: remove surface grease, clean the vent hood, and dust/wipe accessible fridge and cabinet tops.`);
    add('3. Kitchen',`Kitchens × ${n}: clean the microwave inside and out, stovetop/grates/knobs, appliance exteriors, and cabinet/drawer exteriors.`);
    add('3. Kitchen',`Kitchens × ${n}: clean counters and finish with the sink; use products suitable for the surfaces.`);
  }
  if(intake.rooms.baths){const n=intake.rooms.baths;
    add('4. Bathrooms',`Bathrooms × ${n}: apply suitable cleaners to shower/tub and toilet; follow product contact times and use separate bathroom cloths.`);
    if(intake.service==='detailed')add('4. Bathrooms',`Bathrooms × ${n}: address agreed surface buildup and hard-water/soap stains with suitable products. Stop and report extensive mold or unsafe conditions.`);
    add('4. Bathrooms',`Bathrooms × ${n}: clean mirrors, counters, sinks, cabinet/drawer exteriors, shower/tub, then toilet.`);
  }
  for(const [key,n] of Object.entries(intake.rooms)){if(!n||['baths','kitchens'].includes(key))continue;
    if(intake.service==='detailed')add('5. Living spaces & bedrooms',`${roomNames[key]} × ${n}: tidy agreed items and clean under/behind safely accessible furniture; respect rooms or items marked to skip.`);
    if(key==='beds')add('5. Living spaces & bedrooms',`Bedrooms × ${n}: make beds; change linens only where selected.`);
  }
  for(const [key,n] of Object.entries(intake.extras))if(n)add('6. Selected add-ons',`${extraNames[key]} × ${n}${key==='laundry'?': finish the approved loads and return laundry as agreed.':': follow client instructions and surface/care labels.'}`);
  for(const [key,n] of Object.entries(intake.rooms))if(n)add('7. Floors — finish toward the exit',`${roomNames[key]} × ${n}: vacuum carpets/rugs, sweep hard floors, then mop with the appropriate product. Leave a clear exit and allow floors to dry.`);
  add('8. Final walkthrough','Check the agreed rooms and extras, return moved items, collect equipment, and note anything unfinished or needing follow-up.');
  add('8. Final walkthrough','Confirm the property is secure as instructed and review the finished work with the client when available. Photos only with valid permission.');
  return tasks;
}
export function initializeJobs(db){db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
 id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT UNIQUE, external_version INTEGER NOT NULL DEFAULT -1,
 external_json TEXT NOT NULL DEFAULT '{}', intake_json TEXT NOT NULL DEFAULT '{}', work_json TEXT NOT NULL DEFAULT '{}',
 tasks_json TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1,
 submission_key TEXT UNIQUE, submission_hash TEXT, linked_to TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS integration_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
`);}
function read(row){return row?{id:row.id,source:row.source,squareId:row.external_id,squareVersion:row.external_version,external:JSON.parse(row.external_json),intake:JSON.parse(row.intake_json),work:JSON.parse(row.work_json),tasks:JSON.parse(row.tasks_json),revision:row.revision,linkedTo:row.linked_to,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
export function getJob(db,id){const job=read(db.prepare('SELECT * FROM jobs WHERE id=?').get(id));if(!job)problem(404,'Appointment not found.');return job;}
export function listJobs(db){return db.prepare('SELECT * FROM jobs WHERE linked_to IS NULL ORDER BY created_at DESC').all().map(read);}
export function createRequest(db,data){
  const key=text(data.submissionKey,80,true);if(!/^[a-zA-Z0-9-]{20,80}$/.test(key))problem(400,'Invalid submission reference.');
  const intake=normalizeIntake(data),fingerprint=hash(JSON.stringify(intake));
  const existing=db.prepare('SELECT id,submission_hash FROM jobs WHERE submission_key=?').get(key);
  if(existing){if(existing.submission_hash!==fingerprint)problem(409,'This submission was already saved. Start a new request for changed details.');return existing.id;}
  const id=randomUUID(),now=Date.now();
  db.prepare(`INSERT INTO jobs(id,source,intake_json,work_json,tasks_json,submission_key,submission_hash,created_at,updated_at) VALUES (?,'website',?,?,?,?,?,?,?)`).run(id,JSON.stringify(intake),JSON.stringify({stage:'needs_review',scopeApproved:false}),JSON.stringify(makeChecklist(intake)),key,fingerprint,now,now);
  return id;
}
export function cancelled(job){return ['CANCELLED_BY_SELLER','CANCELLED_BY_CUSTOMER','DECLINED','NO_SHOW'].includes(job.external.status)||job.work.stage==='cancelled';}
function current(db,id,revision){const job=getJob(db,id);if(job.linkedTo)problem(409,'This intake is attached to another appointment. Open that appointment.');if(!Number.isInteger(revision)||revision!==job.revision)problem(409,'This appointment changed on another screen. Refresh it before saving.');return job;}
function save(db,job){db.prepare('UPDATE jobs SET intake_json=?,work_json=?,tasks_json=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(job.intake),JSON.stringify(job.work),JSON.stringify(job.tasks),Date.now(),job.id);return getJob(db,job.id);}
export function reviewJob(db,id,data,actor){
  const job=current(db,id,data.revision);
  if(cancelled(job)||job.work.stage==='completed')problem(409,'This appointment is closed.');
  if(data.approved!==true)problem(400,'Confirm the client, service address, and agreed cleaning scope.');
  const agreed=scope(data),address=text(data.address,500,true),notes=text(data.staffNotes,4000);
  let startAt=job.external.startAt;
  if(job.source==='website')startAt=easternTime(text(data.date,10,true),text(data.time,5,true));
  if(!startAt||!Number.isFinite(Date.parse(startAt)))problem(400,'A valid appointment time is required.');
  job.work={...job.work,stage:'ready',scopeApproved:true,squareChanged:false,address,name:text(data.name,120,true),email:text(data.email,254),phone:text(data.phone,50,true),staffNotes:notes,startAt,reviewedBy:actor,reviewedAt:Date.now(),reviewedSquareVersion:job.squareVersion};
  // Retain original client submission and store the staff-approved scope separately.
  job.work.scope=agreed;
  const previous=new Map(job.tasks.map(t=>[t.id,t]));
  job.tasks=makeChecklist(agreed).map(t=>previous.get(t.id)||t);
  return save(db,job);
}
export function updateJob(db,id,data,actor){
  const job=current(db,id,data.revision);
  if(data.action==='note'){job.work.staffNotes=text(data.notes,4000);return save(db,job);}
  if(data.action==='cancel'){
    if(job.source==='square')problem(409,'Cancel Square appointments in Square, then sync.');
    if(job.work.stage==='completed')problem(409,'Completed work cannot be cancelled.');
    job.work.stage='cancelled';return save(db,job);
  }
  if(cancelled(job))problem(409,'This appointment is cancelled or unavailable.');
  if(!job.work.scopeApproved||job.work.stage==='needs_review')problem(409,'Review and confirm the cleaning plan before starting.');
  if(job.source==='square'&&job.external.status!=='ACCEPTED')problem(409,'This Square appointment has not been accepted.');
  if(job.work.stage==='completed')problem(409,'This job is already completed.');
  if(data.action==='task'){
    const task=job.tasks.find(t=>t.id===data.taskId);if(!task||typeof data.done!=='boolean')problem(400,'Invalid checklist item.');
    task.done=data.done;task.completedAt=data.done?Date.now():null;task.completedBy=data.done?actor:null;job.work.stage='in_progress';
  }else if(data.action==='complete'){
    if(!job.tasks.length||!job.tasks.every(t=>t.done))problem(409,'Finish every checklist item before marking the job complete. Record exceptions in the work notes.');
    job.work.stage='completed';job.work.completedAt=Date.now();job.work.completedBy=actor;
  }else problem(400,'Unknown job action.');
  return save(db,job);
}
export function linkRequest(db,id,data,actor){
  const job=current(db,id,data.revision),request=current(db,text(data.requestId,80,true),data.requestRevision);
  if(job.source!=='square'||request.source!=='website'||job.intake.name||['in_progress','completed'].includes(job.work.stage)||request.work.stage==='completed'||cancelled(job)||cancelled(request))problem(409,'These records cannot be linked. Link an unstarted Square appointment and an unlinked intake.');
  if(data.confirmed!==true)problem(400,'Confirm these records belong to the same client and visit.');
  db.exec('BEGIN');
  try{
    job.intake=request.intake;job.tasks=makeChecklist(request.intake);job.work={...job.work,stage:'needs_review',scopeApproved:false,linkedRequest:request.id,linkedBy:actor};
    save(db,job);db.prepare('UPDATE jobs SET linked_to=?,revision=revision+1,updated_at=? WHERE id=?').run(job.id,Date.now(),request.id);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  return getJob(db,job.id);
}
export function importSquare(db,external){
  const old=db.prepare('SELECT * FROM jobs WHERE external_id=?').get(external.id);
  if(old&&old.external_version>external.version)return;
  if(old){
    const job=read(old);
    if(JSON.stringify(job.external)===JSON.stringify(external))return;
    // Rescheduling, notes, customer, address, or service changes require a fresh scope review.
    const relevant=x=>JSON.stringify([x.startAt,x.status,x.customerId,x.address,x.service,x.customerNote,x.sellerNote,x.customerProfileNote,x.name,x.phone,x.email]);
    if(relevant(job.external)!==relevant(external)&&job.work.stage!=='completed')job.work={...job.work,stage:'needs_review',scopeApproved:false,squareChanged:true};
    db.prepare('UPDATE jobs SET external_version=?,external_json=?,work_json=?,revision=revision+1,updated_at=? WHERE id=?').run(external.version,JSON.stringify(external),JSON.stringify(job.work),Date.now(),job.id);
  }else{
    const now=Date.now();db.prepare(`INSERT INTO jobs(id,source,external_id,external_version,external_json,work_json,created_at,updated_at) VALUES (?,'square',?,?,?,?,?,?)`).run(randomUUID(),external.id,external.version,JSON.stringify(external),JSON.stringify({stage:'needs_review',scopeApproved:false}),now,now);
  }
}
