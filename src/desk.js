import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {interpretOrder} from './order-interpret.js';
import {validDate} from './interpret.js';
import {INVENTORY,itemName,dayCount,dateLabel} from './catalog.js';

const emptyOrder=()=>({items:[],start:null,end:null});
const known=id=>INVENTORY.some(i=>i.id===id);
const normalizeDraft=d=>({items:Array.isArray(d?.items)?d.items.map(i=>({...i})):d?.itemId?[{itemId:d.itemId,quantity:d.quantity??null}]:[],start:d?.start??null,end:d?.end??null});
const publicDraft=d=>({...d,itemId:d.items.length===1?d.items[0].itemId:null,quantity:d.items.length===1?d.items[0].quantity:null});
const describeItems=items=>items.map(i=>`${i.quantity} ${itemName(i.itemId)} unit${i.quantity===1?'':'s'}`).join(', ');
const welcome='Hi! Tell me which equipment you need, how many of each, and the dates. You can reserve Camera A, Tripod B and Microphone C together in one booking.';
export class DeskError extends Error {constructor(message,status=400,state){super(message);this.status=status;this.state=state;}}

/** Authoritative order state and one atomic reservation across all equipment lines. */
export class Desk {
 constructor(file=':memory:') {
  this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,draft TEXT NOT NULL,pending TEXT,reply TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY,item_id TEXT NOT NULL CHECK(item_id IN ('camera','tripod','microphone')),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),start_date TEXT NOT NULL,end_date TEXT NOT NULL,session_id TEXT UNIQUE REFERENCES sessions(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(start_date<=end_date));
   CREATE TABLE IF NOT EXISTS events(session_id TEXT NOT NULL REFERENCES sessions(id),id TEXT NOT NULL,request TEXT NOT NULL,reply TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(session_id,id));
   CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,start_date TEXT NOT NULL,end_date TEXT NOT NULL,session_id TEXT UNIQUE REFERENCES sessions(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK(start_date<=end_date));
   CREATE TABLE IF NOT EXISTS reservation_items(reservation_id TEXT NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,item_id TEXT NOT NULL CHECK(item_id IN ('camera','tripod','microphone')),quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 99),PRIMARY KEY(reservation_id,item_id));`);
  // Additive, once-only migration. Original booking/session/event rows are never
  // rewritten or removed. Historical IDs and creation times remain unchanged.
  this.db.exec('BEGIN IMMEDIATE');
  try {
   this.db.prepare("INSERT OR IGNORE INTO bookings(id,item_id,quantity,start_date,end_date) VALUES('SEED-CAMERA-OCT','camera',1,'2026-10-10','2026-10-12')").run();
   if(!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get()){
    this.db.exec(`INSERT INTO reservations(id,start_date,end_date,session_id,created_at) SELECT id,start_date,end_date,session_id,created_at FROM bookings;
     INSERT INTO reservation_items(reservation_id,item_id,quantity) SELECT id,item_id,quantity FROM bookings;
     INSERT INTO schema_migrations(version) VALUES(2);`);
   }
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}
 }
 close(){this.db.close();}
 createSession(){const id=randomUUID();this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run(id,0,'collecting',JSON.stringify(emptyOrder()),null,welcome);return this.state(id);}
 session(id){
  const r=this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id);if(!r)throw new DeskError('Conversation not found. Start a new conversation.',404);
  const original=JSON.parse(r.draft),draft=normalizeDraft(original),pending=JSON.parse(r.pending||'null');
  if(pending?.slot==='quantity'&&!pending.itemId&&draft.items.length===1)pending.itemId=draft.items[0].itemId;
  if(pending?.patch?.itemId)pending.patch={items:[{itemId:pending.patch.itemId,quantity:original.quantity??null}]};
  return {...r,draft,pending};
 }
 save(s){this.db.prepare('UPDATE sessions SET revision=?,status=?,draft=?,pending=?,reply=? WHERE id=?').run(s.revision,s.status,JSON.stringify(s.draft),s.pending?JSON.stringify(s.pending):null,s.reply,s.id);}
 bookings(){
  return this.db.prepare('SELECT id,start_date AS start,end_date AS end,session_id AS sessionId,created_at AS createdAt FROM reservations ORDER BY rowid').all().map(r=>{
   const rows=this.db.prepare('SELECT item_id AS itemId,quantity FROM reservation_items WHERE reservation_id=? ORDER BY CASE item_id WHEN \'camera\' THEN 1 WHEN \'tripod\' THEN 2 ELSE 3 END').all(r.id).map(i=>({...i}));
   return {...r,...(rows.length===1?{itemId:rows[0].itemId,quantity:rows[0].quantity}:{}),items:rows};
  });
 }
 remaining(itemId,start,end){
  const item=INVENTORY.find(i=>i.id===itemId);if(!item||!validDate(start)||!validDate(end)||start>end)return null;
  const occupied=this.db.prepare('SELECT i.quantity,r.start_date AS start,r.end_date AS end FROM reservation_items i JOIN reservations r ON r.id=i.reservation_id WHERE i.item_id=? AND r.start_date<=? AND r.end_date>=?').all(itemId,end,start);
  const changes=new Map();
  for(const r of occupied){const first=r.start>start?r.start:start,last=r.end<end?r.end:end;const after=new Date(last+'T00:00:00Z');after.setUTCDate(after.getUTCDate()+1);const next=after.toISOString().slice(0,10);changes.set(first,(changes.get(first)||0)+r.quantity);changes.set(next,(changes.get(next)||0)-r.quantity);}
  let used=0,peak=0;for(const d of [...changes.keys()].sort()){used+=changes.get(d);peak=Math.max(peak,used);}return item.stock-peak;
 }
 availability(d){
  if(!d.items.length||!validDate(d.start)||!validDate(d.end)||d.start>d.end)return null;
  const items=d.items.map(i=>({itemId:i.itemId,requested:i.quantity,remaining:this.remaining(i.itemId,d.start,d.end)}));
  if(items.some(i=>i.remaining===null||!Number.isInteger(i.requested)))return null;
  for(const i of items)i.available=i.remaining>=i.requested;
  return {available:items.every(i=>i.available),items,remaining:items.length===1?items[0].remaining:null};
 }
 snapshot(){return {inventory:INVENTORY,bookings:this.bookings()};}
 state(id,extra={}) {
  const s=this.session(id),bookings=this.bookings();
  const missing=!s.draft.items.length?'items':s.draft.items.some(i=>!Number.isInteger(i.quantity))?'quantity':!s.draft.start||!s.draft.end?'dates':null;
  return {sessionId:id,revision:s.revision,status:s.status,draft:publicDraft(s.draft),reply:s.reply,speechReply:s.reply,missingSlot:s.pending?.slot||missing,
   clarification:s.pending?{prompt:s.pending.prompt,candidates:s.pending.candidates||[],itemId:s.pending.itemId||null}:null,
   inventory:INVENTORY.map(i=>({...i,remaining:this.remaining(i.id,s.draft.start,s.draft.end)})),bookings,booking:bookings.find(b=>b.sessionId===id)||null,
   availability:this.availability(s.draft),
   events:this.db.prepare('SELECT id,request,reply,status,created_at AS createdAt FROM events WHERE session_id=? ORDER BY rowid').all(id).map(e=>({id:e.id,transcript:JSON.parse(e.request).transcript,reply:e.reply,status:e.status,createdAt:e.createdAt})),
   metrics:{processingMs:0},...extra};
 }
 review(s,prefix='') {
  const d=s.draft;s.pending=null;s.status='collecting';
  const ask=(slot,prompt,extra={})=>{s.pending={kind:'clarify',slot,prompt,...extra};s.reply=prefix+prompt;};
  if(!d.items.length)return ask('items','Which equipment do you need: Camera A, Tripod B, Microphone C, or a combination?');
  if(d.items.length>3||d.items.some(i=>!known(i.itemId))||new Set(d.items.map(i=>i.itemId)).size!==d.items.length)return ask('items','Please name each equipment type once and say how many of each you need.');
  const missing=d.items.find(i=>!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>99);
  if(missing)return ask('quantity',`How many ${itemName(missing.itemId)} units would you like?`,{itemId:missing.itemId});
  if(!d.start||!d.end)return ask('dates','What are the shared start and end dates for this booking? Please include the year.');
  if(!validDate(d.start)||!validDate(d.end))return ask('dates','That date is not on the calendar. What are your exact start and end dates?');
  if(d.start>d.end)return ask('dates','The return date is before the start. What date range should I use?');
  const days=dayCount(d.start,d.end);if(days>366)return ask('dates','I can reserve up to 366 days. What shorter date range would you like?');
  const shortage=this.availability(d).items.filter(i=>!i.available);
  if(shortage.length){
   s.status='unavailable';
   const details=shortage.map(i=>i.remaining===0?`There are no ${itemName(i.itemId)} units available for all of those dates.`:`I have ${i.remaining} ${itemName(i.itemId)} unit${i.remaining===1?'':'s'} available, but you asked for ${i.requested}.`).join(' ');
   const next=shortage.some(i=>i.remaining===0)?'Please choose different dates or remove the unavailable item from this request.':'Would you like fewer units or different dates?';
   s.reply=`${prefix}${details} ${next} Nothing is booked.`;return;
  }
  s.status='review';s.reply=`${prefix}${describeItems(d.items)}, ${dateLabel(d.start)} through ${dateLabel(d.end)}, including both dates. That’s ${days} day${days===1?'':'s'}${d.items.length>1?' for every item':''}. ${d.items.length>1?'All items are':'It’s'} available. Shall I book ${d.items.length>1?'all of them together':'it'}?`;
 }
 patch(s,patch={}){
  if(Object.hasOwn(patch,'items'))s.draft.items=patch.items.map(i=>({...i}));
  for(const k of ['start','end'])if(Object.hasOwn(patch,k))s.draft[k]=patch[k];
 }
 ask(s,issue,pending){
  if(issue.slot==='dates'||issue.slot==='year'){s.draft.start=null;s.draft.end=null;}
  if(issue.slot==='quantity'){
   const target=issue.itemId||pending?.itemId||(s.draft.items.length===1?s.draft.items[0].itemId:null);
   s.draft.items=s.draft.items.map(i=>!target||i.itemId===target?{...i,quantity:null}:i);
  }
  if(issue.slot==='itemId'||issue.slot==='items')s.draft.items=[];
  s.status='collecting';s.pending={kind:'clarify',...issue,...(pending||{})};
  if(!pending&&['itemId','items'].includes(issue.slot)&&issue.candidates?.length===1&&known(issue.candidates[0]))s.pending={...s.pending,kind:'suggestion',patch:{items:[{itemId:issue.candidates[0],quantity:null}]}};
  s.reply=issue.prompt||'Please say the detail you want to change.';
 }
 answer(s,result){
  const q=result.question;
  if(q==='status'){
   if(s.pending&&(s.pending.slot!=='intent'||s.pending.retainedItems)){s.reply=s.pending.prompt||'Please clarify the unresolved equipment before reviewing the reservation.';return;}
   const b=this.bookings().find(b=>b.sessionId===s.id);
   if(b){s.reply=`Your reservation ${b.id} is saved: ${describeItems(b.items)}, ${dateLabel(b.start)} through ${dateLabel(b.end)}. No new booking was made.`;return;}
   if(s.draft.items.length||s.draft.start||s.draft.end){this.review(s,'Here’s your current request. ');return;}
   s.reply='Nothing is booked yet. Which equipment would you like?';return;
  }
  if(q==='availability'){if(s.pending&&(['itemId','items'].includes(s.pending.slot)||s.pending.kind==='suggestion')){s.reply=s.pending.prompt||'Please clarify the equipment first.';return;}this.patch(s,result.patch);if(result.issue){this.ask(s,result.issue,result.pending);return;}this.review(s);return;}
  // Informational detours never discard unresolved equipment or meaning approval.
  s.status=s.status==='booked'?'booked':'collecting';
  if(q==='catalog')s.reply='We have Camera A: two units, Tripod B: three, and Microphone C: one. You can combine them in one reservation. Availability depends on your dates. What would you like?';
  else if(q==='cost')s.reply='This is a booking demo, so prices and payments aren’t included. Your request has not been booked. Tell me when you’re ready to review it.';
  else if(q==='help')s.reply='Hold the microphone while you speak, then release when you’re done. Name each equipment type and how many of each, followed by the shared dates. You can correct any detail before confirming the full review.';
  else s.reply='I can help with equipment, dates, availability, and reservations. I don’t have information about that. Your booking details haven’t changed.';
 }
 commit(s) {
  if(s.status!=='review'){
   if(s.status==='unavailable'){this.review(s);if(s.status==='unavailable')s.reply='I can’t book that request. '+s.reply;return;}
   if(s.pending){s.reply=s.pending.prompt;return;}
   this.review(s,'Let’s check the details first. ');return;
  }
  this.review(s);if(s.status!=='review')return;
  const d=s.draft,id='BK-'+randomUUID().slice(0,8).toUpperCase();
  this.db.prepare('INSERT INTO reservations(id,start_date,end_date,session_id) VALUES(?,?,?,?)').run(id,d.start,d.end,s.id);
  const insert=this.db.prepare('INSERT INTO reservation_items(reservation_id,item_id,quantity) VALUES(?,?,?)');
  for(const item of d.items)insert.run(id,item.itemId,item.quantity);
  s.status='booked';s.pending=null;s.reply=`You’re booked. ${describeItems(d.items)}, ${dateLabel(d.start)} through ${dateLabel(d.end)}${d.items.length>1?', in one reservation':''}. Your reference is ${id}.`;
 }
 turn(input) {
  const time=performance.now();
  const {sessionId,eventId,expectedRevision,transcript,alternatives,source='voice'}=input||{};
  if(typeof sessionId!=='string'||!sessionId||typeof eventId!=='string'||!eventId||eventId.length>128||!Number.isInteger(expectedRevision)||expectedRevision<0||typeof transcript!=='string'||!transcript.trim()||transcript.length>2000||!['voice','button','test'].includes(source))throw new DeskError('A conversation, event ID, revision and spoken transcript are required.');
  if(alternatives!==undefined&&(!Array.isArray(alternatives)||alternatives.length>10||alternatives.some(a=>!a||typeof a.transcript!=='string'||!a.transcript.trim()||a.transcript.length>2000||(a.confidence!==undefined&&(!Number.isFinite(a.confidence)||a.confidence<0||a.confidence>1)))))throw new DeskError('Invalid speech alternatives.');
  const request=JSON.stringify({transcript:transcript.trim(),expectedRevision,source,...(alternatives?{alternatives}:{})});
  this.db.exec('BEGIN IMMEDIATE');
  try {
   const prior=this.db.prepare('SELECT request FROM events WHERE session_id=? AND id=?').get(sessionId,eventId);
   if(prior){if(prior.request!==request)throw new DeskError('This event ID belongs to a different turn.',409,this.state(sessionId));this.db.exec('COMMIT');return this.state(sessionId,{replayed:true,metrics:{processingMs:performance.now()-time}});}
   const s=this.session(sessionId);
   if(expectedRevision!==s.revision)throw new DeskError('The conversation changed. Review the latest details before trying again.',409,this.state(sessionId));
   // A targeted recovery marker preserves the stored draft until the next user
   // turn, then restores only explicitly mentioned unresolved lines as null.
   if(s.status!=='booked'&&s.pending?.safetyRecovery&&s.pending.retainedItems)this.patch(s,{items:s.pending.retainedItems});
   const result=interpretOrder(transcript,s);
   if(s.status==='booked'){
    const booking=this.bookings().find(b=>b.sessionId===s.id);
    if(result.intent==='question'&&result.question==='status')this.answer(s,result);
    else if(result.intent==='question'&&result.question==='availability'){
     const query={...s.draft,...(result.patch||{})};const available=result.issue?null:this.availability(query);
     s.reply=available?available.items.map(i=>`${i.remaining} ${itemName(i.itemId)} units remain for ${dateLabel(query.start)} through ${dateLabel(query.end)}.`).join(' ')+' Your saved reservation is unchanged.':`Your saved reservation ${booking.id} is unchanged. Start a new conversation to check another request.`;
    }else s.reply=`Reservation ${booking.id} is already saved. I haven’t created another booking. Start a new conversation for another reservation.`;
   }else if(result.intent==='cancel'){
    s.status='cancelled';s.draft=emptyOrder();s.pending=null;s.reply='Cancelled. Nothing was booked. Tell me a new request whenever you’re ready.';
   }else{
    const conflict=this.speechConflict(transcript,alternatives,s,result);
    if(conflict){this.patch(s,conflict.patch);this.ask(s,conflict.issue,conflict.pending);}
    else if(s.pending?.kind==='suggestion'&&result.intent==='confirm'){this.patch(s,s.pending.patch);this.review(s,'Thanks. ');}
    else if(result.intent==='confirm')this.commit(s);
    else if(result.intent==='question')this.answer(s,result);
    else if(result.intent==='repeat'){if(s.status==='review')this.review(s);else if(s.pending)s.reply=s.pending.prompt;}
    else if(result.intent==='unknown'&&s.pending)s.reply=(s.pending.slot==='quantity'?'I didn’t catch the quantity. ':'')+(s.pending.prompt||'Please clarify the unresolved equipment.');
    else{this.patch(s,result.patch);if(result.issue)this.ask(s,result.issue,result.pending);else if(Object.keys(result.patch||{}).length)this.review(s);else{s.status='collecting';s.pending=null;s.reply='Tell me the equipment or the detail you’d like to change.';}}
   }
   s.revision++;this.save(s);
   this.db.prepare('INSERT INTO events(session_id,id,request,reply,status) VALUES(?,?,?,?,?)').run(sessionId,eventId,request,s.reply,s.status);
   this.db.exec('COMMIT');return this.state(sessionId,{metrics:{processingMs:performance.now()-time}});
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 /** Lower ASR alternatives are clarification evidence, never booking authority. */
 speechConflict(text,alternatives,s,primary){
  if(!alternatives?.length)return null;
  const parsed=alternatives.filter(a=>a.transcript.trim()!==text.trim()).map(a=>interpretOrder(a.transcript,s)),rest=parsed.slice(0,2);
  const retained=()=>{
   const lines=primary.pending?.retainedItems||primary.pending?.patch?.items||
    (primary.patch?.items?.length?primary.patch.items:null)||s.pending?.retainedItems||s.pending?.patch?.items||s.draft.items;
   return (lines||[]).map(i=>({...i}));
  };
  // Parse candidate names without inherited order context: an alternative naming
  // Tripod B must not turn every retained order line into an ASR candidate.
  const candidateIds=list=>list.flatMap(a=>{
   const r=interpretOrder(a.transcript,{draft:emptyOrder()});
   if(r.intent!=='update'||(r.issue&&!['quantity','dates','year'].includes(r.issue.slot)))return [];
   return (r.patch?.items||[]).map(i=>i.itemId);
  });
  const retainedClarification=(patch,issue)=>({patch,issue,pending:{kind:'clarify',...issue,retainedItems:retained()}});
  const suggestion=ids=>{
   const candidates=[...new Set(ids.filter(known))];
   if(candidates.length===1){const itemId=candidates[0],prompt=`Did you mean ${itemName(itemId)}?`,items=retained();if(!items.some(i=>i.itemId===itemId))items.push({itemId,quantity:null});return{patch:{},issue:{slot:'items',prompt},pending:{kind:'suggestion',slot:'items',prompt,retainedItems:items,patch:{items},candidates:[itemName(itemId)]}};}
   if(candidates.length>1)return retainedClarification({},{slot:'items',prompt:'I heard different equipment names. Please name the items you want and how many of each.',candidates:candidates.map(itemName)});
   return null;
  };
  if(primary.intent==='unknown'&&!s.draft.items.length){const recovery=suggestion(candidateIds(alternatives));if(recovery)return recovery;}
  if(primary.intent==='confirm'&&rest.some(r=>r.intent==='cancel'||(r.intent==='update'&&Object.keys(r.patch||{}).length))){
   if(s.pending?.kind==='suggestion')return retainedClarification({items:[]},{slot:'items',prompt:'I heard conflicting answers. Please name the equipment you mean.'});
   if(s.pending?.retainedItems)return retainedClarification({items:[]},{slot:'items',prompt:'I heard conflicting answers. Please clarify the equipment and quantities before reviewing the reservation.'});
   return{patch:{},issue:{slot:'intent',prompt:'I heard conflicting approval. Nothing is booked. Please ask me to review the booking, then confirm the details clearly.'}};
  }
  // Revoke every disputed field before choosing the next question. Asking
  // about the first conflict must not leave a second conflicting count intact.
  const patch={...(primary.patch||{})};
  const dateConflict=['start','end'].some(key=>primary.patch?.[key]&&rest.some(r=>r.intent!=='cancel'&&r.patch?.[key]&&r.patch[key]!==primary.patch[key]));
  if(dateConflict){patch.start=null;patch.end=null;}
  const items=primary.patch?.items;
  const other=rest.filter(r=>r.intent!=='cancel'&&r.patch?.items?.length).map(r=>r.patch.items);
  const itemConflict=items?.length&&other.some(list=>list.map(i=>i.itemId).sort().join(',')!==items.map(i=>i.itemId).sort().join(','));
  const quantities=items?.filter(item=>item.quantity!=null&&other.some(list=>list.some(i=>i.itemId===item.itemId&&i.quantity!=null&&i.quantity!==item.quantity)))||[];
  if(itemConflict)patch.items=[];
  else if(quantities.length){const disputed=new Set(quantities.map(i=>i.itemId));patch.items=items.map(i=>disputed.has(i.itemId)?{...i,quantity:null}:i);}
  if(itemConflict)return retainedClarification(patch,{slot:'items',prompt:'I heard different equipment lists. Please name each item and quantity you want in this reservation. Say remove followed by an item name if you do not want it.'});
  if(dateConflict)return{patch,issue:{slot:'dates',prompt:'I heard two different date ranges. What are the exact shared start and end dates, including the year?'}};
  if(quantities.length){const itemId=quantities[0].itemId;return{patch,issue:{slot:'quantity',itemId,prompt:`I heard different quantities for ${itemName(itemId)}. How many units should I reserve?`}};}
  if(['itemId','items'].includes(primary.issue?.slot)&&!items?.length){const recovery=suggestion(candidateIds(alternatives.filter(a=>a.transcript.trim()!==text.trim()).slice(0,2)));if(recovery)return{...recovery,patch:primary.patch||{}};}
  return null;
 }
}
