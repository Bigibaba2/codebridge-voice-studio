import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Desk} from '../src/desk.js';
const request='one Camera A, two Tripod B and one Microphone C from December 14 to December 16 2026';
const expected=[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2},{itemId:'microphone',quantity:1}];
const lines=items=>[...items].sort((a,b)=>a.itemId.localeCompare(b.itemId));
const turn=(d,s,transcript,extra={})=>d.turn({sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript,source:'test',...extra});
function counts(d){return{orders:d.db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n,lines:d.db.prepare('SELECT COUNT(*) AS n FROM reservation_items').get().n};}

test('three types are reviewed together and saved as one atomic reservation',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);assert.equal(s.status,'review',s.reply);assert.deepEqual(lines(s.draft.items),lines(expected));assert.equal(s.booking,null);assert.equal(s.bookings.length,1);assert.match(s.reply,/all of them together/);s=turn(d,s,'confirm booking');assert.equal(s.status,'booked');assert.deepEqual(lines(s.booking.items),lines(expected));assert.equal(s.bookings.length,2);assert.deepEqual(counts(d),{orders:2,lines:4});assert.equal(s.booking.start,'2026-12-14');assert.equal(s.booking.end,'2026-12-16');assert.deepEqual(s.inventory.map(i=>i.remaining),[1,1,0]);}finally{d.close();}});

test('multi-item confirmation exact retry and new repeated yes do not duplicate lines',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);const req={sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:'yes',source:'test'};s=d.turn(req);const id=s.booking.id,after=counts(d);const replay=d.turn(req);assert.equal(replay.replayed,true);assert.equal(replay.booking.id,id);s=turn(d,replay,'confirm booking');assert.equal(s.booking.id,id);assert.deepEqual(counts(d),after);assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM reservations WHERE session_id=?').get(s.sessionId).n,1);}finally{d.close();}});

test('one unavailable line prevents every line from being reserved',()=>{const d=new Desk();try{let owner=turn(d,d.createSession(),'one microphone from December 14 to December 16 2026');owner=turn(d,owner,'yes');const before=d.bookings(),rowCounts=counts(d);let s=turn(d,d.createSession(),request);assert.equal(s.status,'unavailable');assert.match(s.reply,/no Microphone C/);s=turn(d,s,'confirm booking');assert.equal(s.status,'unavailable');assert.equal(s.booking,null);assert.deepEqual(d.bookings(),before);assert.deepEqual(counts(d),rowCounts);assert.deepEqual(s.inventory.map(i=>i.remaining),[2,3,0]);}finally{d.close();}});

test('two connections cannot partly reserve competing multi-item orders',()=>{const dir=mkdtempSync(path.join(tmpdir(),'studio-orders-race-'));let a,b;try{a=new Desk(path.join(dir,'test.sqlite'));b=new Desk(path.join(dir,'test.sqlite'));let sa=turn(a,a.createSession(),request),sb=turn(b,b.createSession(),request);assert.equal(sa.status,'review');assert.equal(sb.status,'review');sa=turn(a,sa,'yes');sb=turn(b,sb,'yes');assert.equal(sa.status,'booked');assert.equal(sb.status,'unavailable');assert.equal(sb.booking,null);assert.deepEqual(counts(a),{orders:2,lines:4});}finally{a?.close();b?.close();rmSync(dir,{recursive:true,force:true});}});

test('failure on a later item rolls back header, earlier lines, revision and event',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);const before=d.bookings(),rowCounts=counts(d),revision=s.revision,events=s.events.length;d.db.exec("CREATE TEMP TRIGGER fail_tripod BEFORE INSERT ON reservation_items WHEN NEW.item_id='tripod' BEGIN SELECT RAISE(ABORT,'injected test failure'); END");const req={sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:'yes',source:'test'};assert.throws(()=>d.turn(req),/injected test failure/);assert.deepEqual(d.bookings(),before);assert.deepEqual(counts(d),rowCounts);assert.equal(d.state(s.sessionId).revision,revision);assert.equal(d.state(s.sessionId).events.length,events);d.db.exec('DROP TRIGGER fail_tripod');s=d.turn(req);assert.equal(s.status,'booked');assert.deepEqual(counts(d),{orders:2,lines:4});}finally{d.close();}});

test('named quantity correction and shared dates preserve all other order lines',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);s=turn(d,s,'change Tripod B quantity to one');assert.equal(s.status,'review',s.reply);assert.deepEqual(lines(s.draft.items),lines(expected.map(i=>i.itemId==='tripod'?{...i,quantity:1}:i)));s=turn(d,s,'Actually December 17 to December 19 2026');assert.equal(s.draft.start,'2026-12-17');assert.equal(s.draft.end,'2026-12-19');s=turn(d,s,'yes');assert.equal(s.bookings.length,2);assert.equal(s.booking.items.length,3);assert.equal(s.booking.start,'2026-12-17');}finally{d.close();}});

test('ambiguous count cannot be revived by an unrelated later date answer',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);s=turn(d,s,'make that two');assert.equal(s.status,'collecting');s=turn(d,s,'December 17 to December 19 2026');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.ok(s.draft.items.some(i=>i.quantity===null));assert.equal(s.bookings.length,1);}finally{d.close();}});

test('unknown extra item blocks partial order despite date followup and yes',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera and two laptops from December 14 to December 16 2026');assert.equal(s.status,'collecting');s=turn(d,s,'December 17 to December 19 2026');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.bookings.length,1);}finally{d.close();}});

test('ASR disagreement about one line asks that quantity without reserving anything',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request,{alternatives:[{transcript:'one Camera A, three Tripod B and one Microphone C from December 14 to December 16 2026'}]});assert.equal(s.status,'collecting');assert.equal(s.draft.items.find(i=>i.itemId==='tripod').quantity,null);assert.equal(s.draft.items.find(i=>i.itemId==='camera').quantity,1);s=turn(d,s,'number two');assert.equal(s.status,'review',s.reply);assert.equal(s.booking,null);s=turn(d,s,'yes');assert.equal(s.booking.items.length,3);}finally{d.close();}});

test('removing unavailable line only changes draft and still requires full review',()=>{const d=new Desk();try{let owner=turn(d,d.createSession(),'one microphone from December 14 to December 16 2026');owner=turn(d,owner,'yes');let s=turn(d,d.createSession(),request);s=turn(d,s,'remove Microphone C');assert.equal(s.status,'review',s.reply);assert.equal(s.booking,null);assert.equal(s.draft.items.length,2);s=turn(d,s,'yes');assert.equal(s.bookings.length,3);assert.equal(s.booking.items.length,2);assert.equal(d.remaining('microphone','2026-12-14','2026-12-16'),0);}finally{d.close();}});

test('saved multi-item order is immutable under corrections, questions, cancel and yes',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),request);s=turn(d,s,'yes');const saved=s.booking;for(const text of ['make that three','remove Camera A','cancel','what equipment do you have?','review booking','yes']){s=turn(d,s,text);assert.equal(s.status,'booked');assert.deepEqual(s.booking,saved);assert.equal(s.bookings.length,2);}}finally{d.close();}});

function legacyFile(file){const db=new DatabaseSync(file);db.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,draft TEXT NOT NULL,pending TEXT,reply TEXT NOT NULL);CREATE TABLE bookings(id TEXT PRIMARY KEY,item_id TEXT NOT NULL,quantity INTEGER NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,session_id TEXT UNIQUE REFERENCES sessions(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE TABLE events(session_id TEXT NOT NULL,id TEXT NOT NULL,request TEXT NOT NULL,reply TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(session_id,id));`);db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?)').run('legacy-session',2,'booked',JSON.stringify({itemId:'tripod',quantity:2,start:'2026-11-14',end:'2026-11-16'}),null,'Historical saved reply');db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?,?)').run('SEED-CAMERA-OCT','camera',1,'2026-10-10','2026-10-12',null,'2026-11-09 10:00:00');db.prepare('INSERT INTO bookings VALUES(?,?,?,?,?,?,?)').run('BK-LEGACY','tripod',2,'2026-11-14','2026-11-16','legacy-session','2026-11-09 11:00:00');db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run('legacy-session','old-event',JSON.stringify({transcript:'confirm booking',expectedRevision:1,source:'voice'}),'Historical saved reply','booked','2026-11-09 11:00:00');db.close();}

test('additive migration preserves all original rows and is safe on repeated startup',()=>{const dir=mkdtempSync(path.join(tmpdir(),'studio-migrate-')),file=path.join(dir,'test.sqlite');let d;try{legacyFile(file);const old=new DatabaseSync(file,{readOnly:true});const before=Object.fromEntries(['sessions','bookings','events'].map(t=>[t,old.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));old.close();d=new Desk(file);for(const table of Object.keys(before))assert.deepEqual(d.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),before[table]);assert.deepEqual(counts(d),{orders:2,lines:2});assert.equal(d.state('legacy-session').booking.id,'BK-LEGACY');assert.deepEqual(d.state('legacy-session').draft.items,[{itemId:'tripod',quantity:2}]);assert.equal(d.remaining('tripod','2026-11-14','2026-11-16'),1);const snapshot=d.bookings();d.close();d=new Desk(file);assert.deepEqual(d.bookings(),snapshot);assert.deepEqual(counts(d),{orders:2,lines:2});const s=turn(d,d.state('legacy-session'),'confirm booking');assert.equal(s.booking.id,'BK-LEGACY');assert.deepEqual(counts(d),{orders:2,lines:2});assert.deepEqual(d.db.prepare('SELECT * FROM bookings ORDER BY rowid').all(),before.bookings);}finally{d?.close();rmSync(dir,{recursive:true,force:true});}});

test('new multi-item reservations persist without being duplicated by migration',()=>{const dir=mkdtempSync(path.join(tmpdir(),'studio-order-restart-')),file=path.join(dir,'test.sqlite');let d;try{d=new Desk(file);let s=turn(d,d.createSession(),request);s=turn(d,s,'yes');const saved=s.booking;d.close();d=new Desk(file);assert.deepEqual(d.state(s.sessionId).booking,saved);assert.deepEqual(counts(d),{orders:2,lines:4});assert.equal(d.db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,1);}finally{d?.close();rmSync(dir,{recursive:true,force:true});}});

test('all conflicting ASR quantities are revoked before the first clarification',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two cameras and two tripods from January 1 to January 2 2027',{alternatives:[{transcript:'one camera and three tripods from January 1 to January 2 2027'}]});assert.deepEqual(s.draft.items.map(i=>i.quantity),[null,null]);s=turn(d,s,'one');assert.equal(s.status,'collecting');assert.equal(s.draft.items.find(i=>i.itemId==='tripod').quantity,null);s=turn(d,s,'yes');assert.equal(s.booking,null);s=turn(d,s,'three tripods');assert.equal(s.status,'review');s=turn(d,s,'yes');assert.deepEqual(lines(s.booking.items),lines([{itemId:'camera',quantity:1},{itemId:'tripod',quantity:3}]));}finally{d.close();}});

test('date conflict cannot conceal simultaneous ASR quantity conflicts',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'two cameras and two tripods from January 1 to January 2 2027',{alternatives:[{transcript:'one camera and three tripods from January 3 to January 4 2027'}]});assert.equal(s.draft.start,null);assert.deepEqual(s.draft.items.map(i=>i.quantity),[null,null]);s=turn(d,s,'January 3 to January 4 2027');assert.equal(s.status,'collecting');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.deepEqual(s.draft.items.map(i=>i.quantity),[null,null]);}finally{d.close();}});

test('invalid replacement dates remain revoked through quantity clarification',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera and one tripod from January 1 to January 2 2027');assert.equal(s.status,'review');s=turn(d,s,'two dozen cameras from November 31 to December 2 2027');assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);s=turn(d,s,'one');assert.equal(s.status,'collecting');assert.equal(s.draft.start,null);s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.bookings.length,1);}finally{d.close();}});

test('missing replacement year cannot revive obsolete shared dates',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera and one tripod from January 1 to January 2 2027');s=turn(d,s,'two dozen cameras from November 1 to November 2');assert.equal(s.draft.start,null);s=turn(d,s,'one');assert.equal(s.status,'collecting');s=turn(d,s,'yes');assert.equal(s.booking,null);s=turn(d,s,'2028');assert.equal(s.draft.start,'2028-11-01');assert.equal(s.draft.end,'2028-11-02');assert.equal(s.status,'review');assert.equal(s.booking,null);}finally{d.close();}});

test('exclusive and replacement instructions cannot silently keep unwanted lines',()=>{for(const instruction of ['only a camera instead','replace the tripod with a microphone']){const d=new Desk();try{let s=turn(d,d.createSession(),'one camera and two tripods from December 14 to December 16 2026');s=turn(d,s,instruction);assert.equal(s.status,'collecting');assert.deepEqual(s.draft.items,[]);s=turn(d,s,'December 17 to December 19 2026');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.deepEqual(s.draft.items,[]);}finally{d.close();}}});

test('interleaved item dates do not preserve an obsolete named quantity',()=>{const d=new Desk();try{let s=turn(d,d.createSession(),'one camera and two tripods from December 14 to December 16 2026');s=turn(d,s,'two cameras for December 14 and one tripod for December 15 2026');assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);assert.ok(s.draft.items.every(i=>i.quantity===null));s=turn(d,s,'December 17 to December 19 2026');s=turn(d,s,'yes');assert.equal(s.booking,null);assert.equal(s.status,'collecting');}finally{d.close();}});

test('misheard date prefix keeps exact grounded equipment and requires explicit full dates before booking',()=>{
 const d=new Desk();try {
  const before=d.bookings();
  let s=turn(d,d.createSession(),'two tripod B from the summer 20 to December 22 2026');
  assert.equal(s.status,'collecting');assert.equal(s.missingSlot,'dates');
  assert.deepEqual(s.draft.items,[{itemId:'tripod',quantity:2}]);
  assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);
  assert.match(s.reply,/date range|start and end dates/i);assert.doesNotMatch(s.reply,/name each item/i);
  s=turn(d,s,'yes');assert.equal(s.booking,null);assert.deepEqual(d.bookings(),before);
  s=turn(d,s,'December 20 to December 22 2026');assert.equal(s.status,'review');
  assert.deepEqual(s.draft.items,[{itemId:'tripod',quantity:2}]);
  s=turn(d,s,'yes');assert.equal(s.status,'booked');assert.equal(s.booking.start,'2026-12-20');assert.equal(s.booking.end,'2026-12-22');
 }finally{d.close();}
});
test('uncertain date-only replacement cannot retain old reviewed range then save on yes',()=>{
 for(const correction of ['change dates from the summer 20 to December 22 2026','change the end from the summer 20 to December 22 2026']) {
  const d=new Desk();try {
   let s=turn(d,d.createSession(),request);assert.equal(s.status,'review');
   s=turn(d,s,correction);assert.equal(s.status,'collecting',correction);assert.equal(s.missingSlot,'dates',correction);
   assert.deepEqual(lines(s.draft.items),lines(expected));assert.equal(s.draft.start,null);assert.equal(s.draft.end,null);
   s=turn(d,s,'one tripod');s=turn(d,s,'yes');assert.equal(s.booking,null,correction);assert.equal(s.bookings.length,1);
  }finally{d.close();}
 }
});
test('unsupported added equipment remains blocked alongside uncertain dates',()=>{
 const d=new Desk();try {
  let s=turn(d,d.createSession(),'one camera and two tripods and a laptop from the summer 20 to December 22 2026');
  assert.equal(s.status,'collecting');assert.ok(['itemId','items'].includes(s.missingSlot));
  s=turn(d,s,'December 20 to December 22 2026');s=turn(d,s,'yes');
  assert.equal(s.booking,null);assert.equal(s.bookings.length,1);
 }finally{d.close();}
});

test('equipment appended after uncertain dates cannot disappear when dates are corrected',()=>{
 for(const input of [
  'two tripods from the summer20 to December22 2026 and a laptop',
  'two tripods from the summer 20 to December 22 2026 plus a slider',
  'two tripods from the summer 20 to December 22 2026 and two sliders',
  'two tripods from the summer 20 to December 22 2026 and 2 sliders',
  'one camera and two tripods from the summer 20 to December 22 2026 and a laptop'
 ]) {
  const d=new Desk();try {
   const before=d.bookings();let s=turn(d,d.createSession(),input);
   assert.equal(s.status,'collecting',input);assert.ok(['itemId','items'].includes(s.missingSlot),input);
   s=turn(d,s,'December 20 to December 22 2026');assert.equal(s.status,'collecting',input);
   assert.ok(['itemId','items'].includes(s.missingSlot),input);
   s=turn(d,s,'review booking');s=turn(d,s,'yes');
   assert.equal(s.booking,null,input);assert.deepEqual(d.bookings(),before,input);
  }finally{d.close();}
 }
});

test('Actually-prefixed named quantity correction revises full order without saving or changing dates',()=>{
 const d=new Desk();try {
  let s=turn(d,d.createSession(),'one camera and two tripods and one microphone from December 27 to December 29 2026');
  assert.equal(s.status,'review');const before=d.bookings();
  s=turn(d,s,'Actually, change the tripods to one.');
  assert.equal(s.status,'review',s.reply);assert.equal(s.booking,null);assert.deepEqual(d.bookings(),before);
  assert.deepEqual(lines(s.draft.items),lines(expected.map(line=>({...line,quantity:1}))));
  assert.equal(s.draft.start,'2026-12-27');assert.equal(s.draft.end,'2026-12-29');
  s=turn(d,s,'yes');assert.equal(s.status,'booked');
  assert.deepEqual(lines(s.booking.items),lines(expected.map(line=>({...line,quantity:1}))));
 }finally{d.close();}
});

test('incomplete named corrections never revive old quantity after dates and yes',()=>{
 for(const initial of [
  'one camera and two tripods and one microphone from December 27 to December 29 2026',
  'one camera and two tripods and one microphone'
 ]) {
  const d=new Desk();try {
   let s=turn(d,d.createSession(),initial);const before=d.bookings();
   for(const text of ['Change the Tripod','Actually, change the tripod.','Update the tripod']) {
    s=turn(d,s,text);assert.equal(s.status,'collecting',text);assert.equal(s.missingSlot,'quantity',text);
    assert.equal(s.draft.items.find(line=>line.itemId==='tripod').quantity,null,text);
    assert.equal(s.draft.items.find(line=>line.itemId==='camera').quantity,1,text);
    assert.equal(s.draft.items.find(line=>line.itemId==='microphone').quantity,1,text);
   }
   s=turn(d,s,'December 27 to December 29 2026');s=turn(d,s,'yes');
   assert.equal(s.booking,null);assert.equal(s.status,'collecting');assert.deepEqual(d.bookings(),before);
   assert.equal(s.draft.items.find(line=>line.itemId==='tripod').quantity,null);
   s=turn(d,s,'Actually, change the tripods to one.');assert.equal(s.status,'review');assert.equal(s.booking,null);
   assert.equal(s.draft.items.find(line=>line.itemId==='tripod').quantity,1);
   s=turn(d,s,'yes');assert.equal(s.status,'booked');assert.equal(s.booking.items.find(line=>line.itemId==='tripod').quantity,1);
  }finally{d.close();}
 }
});

test('unsupported equipment blocker survives incomplete correction count answer dates and yes',()=>{
 const d=new Desk();try {
  const before=d.bookings();
  let s=turn(d,d.createSession(),'two tripods and a drone from December 20 to December 22 2026');
  for(const text of ['Change the Tripod','one','Change the tripods to one.','December 20 to December 22 2026','review booking','yes']) {
   s=turn(d,s,text);assert.equal(s.status,'collecting',text);assert.equal(s.booking,null,text);
   assert.deepEqual(s.draft.items,[],text);assert.deepEqual(d.bookings(),before,text);
  }
 }finally{d.close();}
});

test('unsupported count-from-to correction cannot save withdrawn old quantity after date restatement',()=>{
 const d=new Desk();try {
  let s=turn(d,d.createSession(),'two tripods from December 27 to December 29 2026');const before=d.bookings();
  s=turn(d,s,'Change the tripod from two to one');assert.equal(s.missingSlot,'quantity');
  assert.equal(s.draft.items[0].quantity,null);assert.equal(s.draft.start,'2026-12-27');assert.equal(s.draft.end,'2026-12-29');
  s=turn(d,s,'December 27 to December 29 2026');s=turn(d,s,'yes');
  assert.equal(s.booking,null);assert.deepEqual(d.bookings(),before);
 }finally{d.close();}
});
