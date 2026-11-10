import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Desk} from '../src/desk.js';
const cases=JSON.parse(readFileSync(new URL('./scenarios.json',import.meta.url)));
function turn(desk,state,transcript,extra={}){return desk.turn({sessionId:state.sessionId,eventId:randomUUID(),expectedRevision:state.revision,transcript,source:'test',...extra});}
for(const scenario of cases)test(`scenario: ${scenario.name}`,()=>{const desk=new Desk();try{let s=desk.createSession();const before=desk.bookings().length;for(const text of scenario.turns)s=turn(desk,s,text);assert.equal(s.status,scenario.expected.status,s.reply);assert.equal(s.bookings.length-before,scenario.expected.newBookings);for(const key of ['itemId','quantity','start','end'])if(scenario.expected[key]!==undefined)assert.equal(s.booking[key],scenario.expected[key]);if(scenario.expected.items)assert.deepEqual([...s.booking.items].sort((a,b)=>a.itemId.localeCompare(b.itemId)),[...scenario.expected.items].sort((a,b)=>a.itemId.localeCompare(b.itemId)));}finally{desk.close();}});
test('database seed, inclusive boundaries and maximum concurrent stock',()=>{const d=new Desk();try{assert.equal(d.bookings().length,1);assert.equal(d.remaining('camera','2026-10-09','2026-10-10'),1);assert.equal(d.remaining('camera','2026-10-12','2026-10-13'),1);assert.equal(d.remaining('camera','2026-10-13','2026-10-14'),2);for(const dates of ['2027-01-01 to 2027-01-02','2027-01-03 to 2027-01-04']){let s=turn(d,d.createSession(),`one camera from ${dates}`);turn(d,s,'yes');}assert.equal(d.remaining('camera','2027-01-01','2027-01-04'),1);}finally{d.close();}});
test('review alone never reserves and new conversation never resets',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripods from 2027-01-01 to 2027-01-02');assert.equal(s.status,'review');assert.equal(d.bookings().length,1);s=turn(d,s,'yes');assert.equal(s.booking.quantity,2);const fresh=d.createSession();assert.equal(fresh.bookings.length,2);assert.equal(d.remaining('tripod','2027-01-01','2027-01-02'),1);}finally{d.close();}});
test('unknown quantity answer keeps the question; number one reaches review only',()=>{
 const d=new Desk();try{let s=turn(d,d.createSession(),'Reserve tripod B from November 14 to November 18 2026');assert.equal(s.missingSlot,'quantity');
  s=turn(d,s,'Ron');assert.equal(s.draft.quantity,null);assert.match(s.reply,/How many Tripod B/);assert.equal(s.missingSlot,'quantity');
  s=turn(d,s,'number one',{alternatives:[{transcript:'number 1'},{transcript:'number run'}]});assert.equal(s.status,'review');assert.deepEqual(s.draft,{items:[{itemId:'tripod',quantity:1}],itemId:'tripod',quantity:1,start:'2026-11-14',end:'2026-11-18'});assert.equal(s.booking,null);
 }finally{d.close();}
});
test('unknown ASR primary can ask about a real catalog alternative without adopting its slots',()=>{
 const d=new Desk();try{
  for(const [primary,alternatives] of [
   ['Palmetto',['Camaro','camera','Palmetto of']],
   ['capital of',['Capital Auto','camera on','camera']],
   ['unrecognized phrase',['noise','other noise','two cameras from December 14 to December 16 2026']]
  ]) {
   let s=turn(d,d.createSession(),primary,{alternatives:alternatives.map(transcript=>({transcript}))});
   assert.match(s.reply,/Did you mean Camera A/);assert.deepEqual(s.draft,{items:[],itemId:null,quantity:null,start:null,end:null});assert.equal(s.booking,null);
   s=turn(d,s,'yes');assert.equal(s.draft.itemId,'camera');assert.equal(s.draft.quantity,null);assert.equal(s.status,'collecting');assert.equal(s.booking,null);assert.match(s.reply,/How many/);
   s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.draft.quantity,null);
  }
 }finally{d.close();}
});
test('alternative recovery never maps unknown words, overrides intent, or chooses conflicting equipment',()=>{
 const d=new Desk();try{
  let s=turn(d,d.createSession(),'Palmetto');assert.equal(s.draft.itemId,null);assert.doesNotMatch(s.reply,/Did you mean Camera/);
  s=turn(d,s,'yes');assert.equal(s.draft.itemId,null);assert.equal(s.booking,null);
  s=turn(d,d.createSession(),'Palmetto',{alternatives:[{transcript:'camera'},{transcript:'tripod B'}]});assert.equal(s.draft.itemId,null);assert.match(s.reply,/different equipment|Which/);s=turn(d,s,'yes');assert.equal(s.draft.itemId,null);assert.equal(s.booking,null);
  s=turn(d,d.createSession(),'cancel',{alternatives:[{transcript:'camera'}]});assert.equal(s.status,'cancelled');assert.equal(s.draft.itemId,null);
  s=turn(d,d.createSession(),'Reserve tripod B from December 14 to December 16 2026');s=turn(d,s,'Ron',{alternatives:[{transcript:'camera'}]});assert.equal(s.draft.itemId,'tripod');assert.equal(s.draft.quantity,null);assert.match(s.reply,/How many Tripod B/);
 }finally{d.close();}
});
test('opposed standalone number replies still need clarification',()=>{
 const d=new Desk();try{let s=turn(d,d.createSession(),'Reserve tripod B from November 14 to November 18 2026');s=turn(d,s,'number one',{alternatives:[{transcript:'number two'}]});assert.equal(s.draft.quantity,null);assert.equal(s.status,'collecting');s=turn(d,s,'yes');assert.equal(s.booking,null);}finally{d.close();}
});
test('zero stock suggests different dates, never fewer units, even on confirmation',()=>{
 const d=new Desk();try{let owner=turn(d,d.createSession(),'three tripods from November 14 to November 16 2026');owner=turn(d,owner,'yes');const before=d.bookings();let s=turn(d,d.createSession(),'two tripods from November 14 to November 16 2026');
  for(const confirm of [false,true]){if(confirm)s=turn(d,s,'confirm booking');assert.equal(s.status,'unavailable');assert.match(s.reply,/different dates/);assert.doesNotMatch(s.reply,/fewer/);assert.match(s.reply,/no Tripod B/i);assert.equal(s.booking,null);assert.deepEqual(s.bookings,before);}
 }finally{d.close();}
});
test('partial stock still offers fewer units without booking them',()=>{
 const d=new Desk();try{let s=turn(d,d.createSession(),'two cameras from October 10 to October 12 2026');assert.equal(s.status,'unavailable');assert.match(s.reply,/1 Camera A/);assert.match(s.reply,/fewer units/);s=turn(d,s,'confirm booking');assert.equal(s.status,'unavailable');assert.match(s.reply,/fewer units/);assert.equal(s.booking,null);assert.equal(s.bookings.length,1);}finally{d.close();}
});
test('unavailable confirmation after stock recovery requires fresh review, including retries',()=>{
 const d=new Desk();try{
  let owner=turn(d,d.createSession(),'one microphone from February 1 to February 2 2028');owner=turn(d,owner,'yes');
  let s=turn(d,d.createSession(),'one microphone from February 1 to February 2 2028');assert.equal(s.status,'unavailable');
  // Test-only in-memory capacity release. The application exposes no deletion API.
  d.db.prepare('DELETE FROM reservations WHERE id=?').run(owner.booking.id);
  const request={sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:'confirm booking',source:'test'};
  s=d.turn(request);assert.equal(s.status,'review');assert.equal(s.booking,null);assert.equal(s.bookings.length,1);
  s=d.turn(request);assert.equal(s.replayed,true);assert.equal(s.status,'review');assert.equal(s.booking,null);assert.equal(s.bookings.length,1);
  s=turn(d,s,'yes');assert.equal(s.status,'booked');assert.equal(s.booking.quantity,1);assert.equal(s.bookings.length,2);
 }finally{d.close();}
});
test('new conversation shows totals without resetting fully reserved date inventory',()=>{
 const d=new Desk();try{
  for(const quantity of ['two','one']){let s=turn(d,d.createSession(),`${quantity} tripods from November 14 to November 16 2026`);s=turn(d,s,'confirm booking');assert.equal(s.status,'booked');}
  const before=d.bookings(),fresh=d.createSession(),total=fresh.inventory.find(i=>i.id==='tripod');
  assert.equal(total.stock,3);assert.equal(total.remaining,null);assert.deepEqual(fresh.bookings,before);assert.equal(fresh.events.length,0);
  let s=turn(d,fresh,'one tripod from November 14 to November 16 2026');assert.equal(s.status,'unavailable');assert.equal(s.inventory.find(i=>i.id==='tripod').remaining,0);
  s=turn(d,s,'confirm booking');assert.equal(s.booking,null);assert.deepEqual(s.bookings,before);
  s=turn(d,s,'November 17 to November 18 2026');assert.equal(s.status,'review');assert.equal(s.inventory.find(i=>i.id==='tripod').remaining,3);assert.deepEqual(s.bookings,before);
 }finally{d.close();}
});
test('exact event retry is idempotent; changed payload rejected',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one microphone from 2027-01-01 to 2027-01-02');const req={sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:'yes',source:'test'};const a=d.turn(req),b=d.turn(req);assert.equal(a.booking.id,b.booking.id);assert.equal(b.replayed,true);assert.equal(b.bookings.length,2);assert.throws(()=>d.turn({...req,transcript:'no'}),e=>e.status===409);}finally{d.close();}});
test('stale revision cannot save an obsolete choice',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripods from 2027-01-01 to 2027-01-02');const stale=s;s=turn(d,s,'make that one');assert.equal(s.draft.quantity,1);assert.throws(()=>turn(d,stale,'yes'),e=>e.status===409);assert.equal(d.bookings().length,1);s=turn(d,s,'yes');assert.equal(s.booking.quantity,1);}finally{d.close();}});
test('availability is rechecked during confirmation across connections',()=>{const dir=mkdtempSync(path.join(tmpdir(),'studio-race-'));let a,b;try{a=new Desk(path.join(dir,'test.sqlite'));b=new Desk(path.join(dir,'test.sqlite'));let sa=turn(a,a.createSession(),'one microphone from 2027-01-01 to 2027-01-02'),sb=turn(b,b.createSession(),'one microphone from 2027-01-01 to 2027-01-02');sa=turn(a,sa,'yes');sb=turn(b,sb,'yes');assert.equal(sa.status,'booked');assert.equal(sb.status,'unavailable');assert.equal(a.bookings().length,2);}finally{a?.close();b?.close();rmSync(dir,{recursive:true,force:true});}});
test('ambiguous correction clears obsolete dates and cannot revive via quantity',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'actually tomorrow');assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);s=turn(d,s,'two');s=turn(d,s,'yes');assert.equal(s.status,'collecting');assert.equal(s.booking,null);}finally{d.close();}});
test('meaning-only ASR item suggestion preserves grounded dates and never books on yes',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'Reserve tree pot November 14 to November 16 2026',{alternatives:[{transcript:'Reserve tripod November 14 to November 16 2026'}]});assert.match(s.reply,/Did you mean Tripod B/);assert.equal(s.draft.start,'2026-11-14');s=turn(d,s,'yes');assert.equal(s.draft.itemId,'tripod');assert.equal(s.draft.quantity,null);assert.equal(s.booking,null);s=turn(d,s,'two');assert.equal(s.status,'review');s=turn(d,s,'yes');assert.equal(s.booking.quantity,2);}finally{d.close();}});
test('noisy lower alternatives do not reject a valid explicit primary',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'I need two number tripod B from November 14 to November 16 2026',{alternatives:[{transcript:'I need two numbers tripod be from November 14 to November 16 2026'},{transcript:'I need to tree pot November 14 November 16 2026'}]});assert.equal(s.status,'review');assert.equal(s.draft.quantity,2);s=turn(d,s,'yes');assert.equal(s.booking.quantity,2);}finally{d.close();}});
test('opposed ASR quantities do not choose by confidence',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripods from November 14 to November 16 2026',{alternatives:[{transcript:'three tripods from November 14 to November 16 2026',confidence:0.01}]});assert.equal(s.status,'collecting');assert.equal(s.draft.quantity,null);s=turn(d,s,'yes');assert.equal(s.booking,null);}finally{d.close();}});
test('confirmation conflict never books',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'yes',{alternatives:[{transcript:'cancel'}]});assert.equal(s.booking,null);assert.equal(s.status,'collecting');s=turn(d,s,'yes');assert.equal(s.booking,null);s=turn(d,s,'review booking');assert.equal(s.status,'review');s=turn(d,s,'yes');assert.ok(s.booking);}finally{d.close();}});
test('informational question never consumes the earlier confirmation context',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'How much does it cost?');assert.equal(s.status,'collecting');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.status,'review');}finally{d.close();}});
test('cancel safely discards draft; repeated yes cannot book it',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'cancel');assert.equal(s.status,'cancelled');assert.deepEqual(s.draft,{items:[],itemId:null,quantity:null,start:null,end:null});s=turn(d,s,'yes');assert.equal(s.booking,null);}finally{d.close();}});
test('invalid input, missing session, mismatched event and invalid alternatives fail safely',()=>{const d=new Desk();try{assert.throws(()=>d.turn({}),e=>e.status===400);assert.throws(()=>d.state('nope'),e=>e.status===404);let s=d.createSession();assert.throws(()=>turn(d,s,'hello',{alternatives:[{transcript:'yes',confidence:2}]}),e=>e.status===400);assert.equal(d.bookings().length,1);}finally{d.close();}});
test('booked conversations remain immutable after all information questions',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one microphone from 2027-01-01 to 2027-01-02');s=turn(d,s,'yes');const id=s.booking.id,original=s.draft;for(const question of ['How many microphones are available from January 1 to January 2 2027?','What equipment do you have?','How much does it cost?','Review booking']){s=turn(d,s,question);assert.equal(s.status,'booked');assert.deepEqual(s.draft,original);s=turn(d,s,'yes');assert.equal(s.booking.id,id);assert.equal(s.bookings.length,2);}}finally{d.close();}});
test('single explicit item clarification accepts meaning yes without reserving',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripod be from November 14 to November 16 2026');assert.match(s.reply,/Do you mean/);s=turn(d,s,'yes');assert.equal(s.draft.itemId,'tripod');assert.equal(s.status,'review');assert.equal(s.booking,null);s=turn(d,s,'yes');assert.equal(s.booking.quantity,2);}finally{d.close();}});
test('rejected dates cannot revive after unrelated quantity update',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'not those dates');s=turn(d,s,'two');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);}finally{d.close();}});
test('ambiguous replacement quantity revokes obsolete quantity',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'make it two or three');s=turn(d,s,'camera');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.draft.quantity,null);}finally{d.close();}});
test('rejected equipment cannot revive on review request',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera from 2027-01-01 to 2027-01-02');s=turn(d,s,'not a camera');s=turn(d,s,'review booking');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.draft.itemId,null);}finally{d.close();}});
test('unrelated numbers and unsupported dozen count are never quantities',()=>{const d=new Desk();try{for(const text of ['camera for two people from November 14 to 16 2026','need camera for room two from November 14 to 16 2026','three people need camera from November 14 to 16 2026','two dozen cameras from November 14 to 16 2026']){let s=turn(d,d.createSession(),text);s=turn(d,s,'camera');s=turn(d,s,'yes');assert.equal(s.booking,null,text);assert.equal(s.draft.quantity,null,text);}}finally{d.close();}});
test('multiple same-turn quantity corrections and spoken decimals ask again',()=>{const d=new Desk();try{for(const correction of ['make that two, change it to one','make that two, actually three','make it two point five']){let s=turn(d,d.createSession(),'one tripod from 2027-01-01 to 2027-01-02');s=turn(d,s,correction);assert.equal(s.draft.quantity,null,correction);s=turn(d,s,'tripod');s=turn(d,s,'yes');assert.equal(s.booking,null,correction);}}finally{d.close();}});
test('contradictory ASR cannot accept meaning-only item suggestion',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripod be from November 14 to November 16 2026');s=turn(d,s,'yes',{alternatives:[{transcript:'no'}]});assert.equal(s.draft.itemId,null);assert.equal(s.status,'collecting');assert.equal(s.booking,null);}finally{d.close();}});
test('unrecognized lower ASR noise does not veto a clear yes',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one tripod from 2027-01-01 to 2027-01-02');s=turn(d,s,'yes',{alternatives:[{transcript:'guess'}]});assert.equal(s.status,'booked');}finally{d.close();}});
test('unsupported day exclusions cannot silently become full inclusive rental',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two tripods from November 14 to 16 2026 excluding weekends');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.draft.start,null);}finally{d.close();}});
