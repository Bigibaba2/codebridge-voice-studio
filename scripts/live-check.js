/** Read-only evidence capture. Never creates sessions, sends speech, books, or resets. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {interpret} from '../src/interpret.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const definitions=JSON.parse(readFileSync(path.join(root,'tests/scenarios.json'))).filter(c=>['normal','correction','stock','interruption','repeat','multi-normal','multi-correction','multi-stock','multi-repeat','multi-interruption','focused-interruption'].includes(c.id));
/** Normalize representation only. Never coerce IDs, dates, quantities or metadata. */
export function canonicalBooking(booking) {
 if(!booking || typeof booking!=='object') throw Error('Missing booking');
 const {itemId,quantity,items,...rest}=booking;
 const lines=Array.isArray(items)?items.map(line=>({...line})):[{itemId,quantity}];
 if(lines.some(line=>!line.itemId || !Number.isInteger(line.quantity) || line.quantity<1) || new Set(lines.map(line=>line.itemId)).size!==lines.length || !lines.length) throw Error('Invalid booking lines');
 if(Array.isArray(items) && (itemId!==undefined || quantity!==undefined) && (lines.length!==1 || lines[0].itemId!==itemId || lines[0].quantity!==quantity)) throw Error('Conflicting legacy aliases');
 return {...rest,items:lines.sort((a,b)=>a.itemId.localeCompare(b.itemId))};
}
const stable=value=>Array.isArray(value)?value.map(stable):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
function sameBooking(a,b) {
 try {return JSON.stringify(stable(canonicalBooking(a)))===JSON.stringify(stable(canonicalBooking(b)));} catch{return false;}
}
function sameLines(actual,expected) {
 try {return JSON.stringify(stable(canonicalBooking({items:actual}).items))===JSON.stringify(stable(canonicalBooking({items:expected}).items));} catch{return false;}
}
export function evaluate(before,after,definition){
 const previousIds=new Set(before.database.bookings.map(b=>b.id));
 const added=after.database.bookings.filter(b=>!previousIds.has(b.id));
 const oldIds=new Set(before.session.events.map(e=>e.id));
 const freshEvents=after.session.events.filter(e=>!oldIds.has(e.id));
 const checks=[];
 const check=(name,passed)=>checks.push({name,passed:Boolean(passed)});
 const rawById=new Map(after.rawEvents.map(e=>[e.id,e.request]));
 let voiceConfirmations=0,voiceBookingApprovals=0,voiceRepeatConfirmations=0;
 let previousStatus=before.session.status;
 for(const event of freshEvents){
  const request=rawById.get(event.id);
  const spokenConfirmation=request?.source==='voice'&&interpret(request.transcript).intent==='confirm';
  if(spokenConfirmation){
   voiceConfirmations++;
   if(previousStatus==='review'&&event.status==='booked')voiceBookingApprovals++;
   if(previousStatus==='booked'&&event.status==='booked')voiceRepeatConfirmations++;
  }
  previousStatus=event.status;
 }
 if(['repeat','multi-repeat'].includes(definition.id)){
  check('No additional reservation',added.length===0);
  check('Same saved reservation ID',before.session.booking?.id&&before.session.booking.id===after.session.booking?.id);
  check('Same saved reservation contents',sameBooking(before.session.booking,after.session.booking));
  if(definition.expected?.items) {
   let actualItems;try{actualItems=canonicalBooking(after.session.booking).items;}catch{actualItems=[];}
   check('Expected repeated reservation lines',sameLines(actualItems,definition.expected.items));
   for(const key of ['start','end'])if(definition.expected[key]!==undefined)check('Correct '+key,after.session.booking?.[key]===definition.expected[key]);
  }
  check('At least two new voice-labelled repeated confirmations of saved booking',voiceRepeatConfirmations>=2);
 }else{
  check('Expected new reservation count',added.length===definition.expected.newBookings);
  check('Expected final status',after.session.status===definition.expected.status);
  if(definition.expected.newBookings){
   const booking=after.session.booking;
   for(const key of ['start','end']) if(definition.expected[key]!==undefined) check('Correct '+key,booking?.[key]===definition.expected[key]);
   const expectedItems=definition.expected.items || [{itemId:definition.expected.itemId,quantity:definition.expected.quantity}];
   let actualItems;try{actualItems=canonicalBooking(booking).items;}catch{actualItems=[];}
   check('Correct equipment and quantities',sameLines(actualItems,expectedItems));
   check('A voice-labelled approval changed the reviewed order to booked',voiceBookingApprovals>=1);
   check('At least one finalized voice input',after.rawEvents.some(e=>!oldIds.has(e.id)&&e.request.source==='voice'));
  }
 }
 check('Existing reservations preserved',before.database.bookings.every(b=>after.database.bookings.some(a=>a.id===b.id&&sameBooking(a,b))));
 return {checks,databaseAssertionsPassed:checks.every(c=>c.passed),voiceConfirmations,voiceBookingApprovals,voiceRepeatConfirmations,newFinalizedTurns:freshEvents.length,newBookings:added.length,recordingVerified:false,acousticLatencyMs:null,warning:'voiceConfirmations counts confirmation-like text, including meaning-only yes. Only voiceBookingApprovals counts a voice-labelled review-to-booked transition. Database assertions and source-labelled transcripts do not establish microphone audio, audible interruption, pauses, or recorded evidence.'};
}
async function main(){
 const [action,value,sessionId]=process.argv.slice(2);
 const definitionsById=Object.fromEntries(definitions.map(c=>[c.id,c]));
 const dbPath=process.env.DB_PATH||path.join(root,'data','studio.sqlite');
 const base=new URL(process.env.LIVE_BASE_URL||'http://127.0.0.1:3010');
 if(!['127.0.0.1','localhost'].includes(base.hostname))throw Error('Only the local demo is allowed.');
 const {DatabaseSync}=await import('node:sqlite');
 const capture=async(id)=>{
  const get=async(url)=>{const r=await fetch(new URL(url,base));if(!r.ok)throw Error('Read failed: '+r.status);return r.json();};
  const database=await get('/api/state'),session=await get('/api/sessions/'+encodeURIComponent(id));
  const db=new DatabaseSync(dbPath,{readOnly:true});let rawEvents;
  try{rawEvents=db.prepare('SELECT id,request FROM events WHERE session_id=? ORDER BY rowid').all(id).map(e=>({...e,request:JSON.parse(e.request)}));}finally{db.close();}
  if(JSON.stringify(database.bookings)!==JSON.stringify(session.bookings)||JSON.stringify(rawEvents.map(e=>e.id))!==JSON.stringify(session.events.map(e=>e.id)))throw Error('Live state changed during capture. Try again when the conversation is idle.');
  return {capturedAt:new Date().toISOString(),database,session,rawEvents};
 };
 if(action==='begin'){
  const definition=definitionsById[value];if(!definition||!sessionId)throw Error('Usage: node scripts/live-check.js begin CASE SESSION_ID (normal, correction, stock, interruption, repeat, multi-normal, multi-correction, multi-stock, multi-repeat, multi-interruption, focused-interruption)');
  const before=await capture(sessionId);
  if(['repeat','multi-repeat'].includes(value)&&!before.session.booking)throw Error('Repeat check requires an existing confirmed booking.');
  if(!['repeat','multi-repeat'].includes(value)&&before.session.booking)throw Error('Start a new conversation in the UI first. No data was changed.');
  const directory=path.join(root,'data','live-checks');mkdirSync(directory,{recursive:true});
  const file=path.join(directory,value+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'-before.json');
  writeFileSync(file,JSON.stringify({definition,before,method:'read-only-live-state-capture',audioCaptured:false},null,2),{flag:'wx'});
  console.log(file);return;
 }
 if(action==='after'){
  const input=JSON.parse(readFileSync(value,'utf8'));
  const after=await capture(input.before.session.sessionId);
  const result={...input,after,evaluation:evaluate(input.before,after,input.definition)};
  const file=value.replace(/-before\.json$/,'-after-'+Date.now()+'.json');if(file===value)throw Error('Expected a before snapshot filename.');
  writeFileSync(file,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({file,...result.evaluation},null,2));return;
 }
 throw Error('Use begin or after; this script only reads live application state.');
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
