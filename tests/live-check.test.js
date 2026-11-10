import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,canonicalBooking} from '../scripts/live-check.js';
const legacy={id:'unchanged-id',itemId:'camera',quantity:1,start:'2026-11-14',end:'2026-11-16',sessionId:'original-session',createdAt:'2026-11-10 01:02:03'};
const modern=(()=>{const {itemId,quantity,...rest}=legacy;return {...rest,items:[{itemId,quantity}]};})();
const event=(id,text='yes',source='voice',status='booked')=>({id,status,request:{transcript:text,source}});
const state=(bookings,booking,events=[],status='booked')=>({database:{bookings},session:{booking,events:events.map(({id,status})=>({id,status})),status},rawEvents:events});
test('legacy and new line representation normalize without changing preserved fields',()=>{
 assert.deepEqual(canonicalBooking(legacy),canonicalBooking(modern));
 const r=evaluate(state([legacy],legacy),state([modern],modern,[event('1'),event('2')]),{id:'repeat'});
 assert.equal(r.databaseAssertionsPassed,true);assert.equal(r.recordingVerified,false);assert.equal(r.acousticLatencyMs,null);
});
test('canonical preservation rejects changed IDs dates quantities timestamps and session identity',()=>{
 for(const altered of [{...modern,id:'new-id'},{...modern,start:'2026-11-15'},{...modern,end:'2026-11-17'},{...modern,createdAt:'other'},{...modern,sessionId:'other'},{...modern,items:[{itemId:'camera',quantity:2}]}]) {
  assert.equal(evaluate(state([legacy],legacy),state([altered],altered,[event('1'),event('2')]),{id:'repeat'}).databaseAssertionsPassed,false);
 }
 assert.throws(()=>canonicalBooking({...modern,itemId:'tripod',quantity:1}));
 assert.throws(()=>canonicalBooking({...modern,items:[{itemId:'camera',quantity:'1'}]}));
});
test('multi-item expected outcomes compare every exact line regardless of presentation order',()=>{
 const lines=[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2},{itemId:'microphone',quantity:1}];
 const booking={id:'new',items:lines,start:'2026-12-01',end:'2026-12-03'};
 const def={id:'multi-normal',expected:{status:'booked',newBookings:1,items:[...lines].reverse(),start:booking.start,end:booking.end}};
 const before=state([legacy],null,[],'collecting');
 const after=state([modern,booking],booking,[event('1','reserve equipment','voice','review'),event('2')]);
 assert.equal(evaluate(before,after,def).databaseAssertionsPassed,true);
 for(const bad of [lines.slice(0,2),[...lines,{itemId:'drone',quantity:1}],lines.map(x=>({...x,quantity:2}))]) {
  const changed={...booking,items:bad};assert.equal(evaluate(before,state([modern,changed],changed,[event('2')]),def).databaseAssertionsPassed,false);
 }
});
test('meaning-only yes followed by button booking cannot masquerade as a voice booking',()=>{
 const booking={id:'new',items:[{itemId:'camera',quantity:1}],start:'2026-12-01',end:'2026-12-03'};
 const def={id:'multi-normal',expected:{status:'booked',newBookings:1,items:booking.items,start:booking.start,end:booking.end}};
 const before=state([legacy],null,[],'collecting');
 for(const extra of [[],[event('4','confirm booking')]]){
  const after=state([legacy,booking],booking,[event('1','yes','voice','collecting'),event('2','one camera from December 1 to 3 2026','voice','review'),event('3','confirm booking','button'),...extra]);
  const result=evaluate(before,after,def);
  assert.equal(result.databaseAssertionsPassed,false);assert.equal(result.voiceBookingApprovals,0);
  assert.equal(result.voiceConfirmations,1+extra.length);assert.equal(result.voiceRepeatConfirmations,extra.length);
 }
});
test('missing event status fails closed rather than treating transcript text as booking proof',()=>{
 const after=state([modern],modern,[event('1'),event('2')]);
 delete after.session.events[0].status;
 assert.equal(evaluate(state([modern],modern),after,{id:'repeat'}).databaseAssertionsPassed,false);
});
test('a voice-labelled input or button confirmation alone does not prove spoken confirmation',()=>{
 const booking={id:'new',items:[{itemId:'camera',quantity:1}],start:'2026-12-01',end:'2026-12-03'};
 const def={id:'multi-normal',expected:{status:'booked',newBookings:1,items:booking.items,start:booking.start,end:booking.end}};
 for(const events of [[event('1','one camera','voice'),event('2','yes','button')],[event('1','yes','button')],[event('1','yes but change it','voice')]]) {
  assert.equal(evaluate(state([legacy],null,[],'collecting'),state([modern,booking],booking,events),def).databaseAssertionsPassed,false);
 }
});
test('multi-repeat requires two new voice confirmations and identical saved contents',()=>{
 const booking={...modern,items:[...modern.items,{itemId:'tripod',quantity:2}]};
 const def={id:'multi-repeat',expected:{items:booking.items,start:booking.start,end:booking.end}};
 assert.equal(evaluate(state([booking],booking),state([booking],booking,[event('1'),event('2')]),def).databaseAssertionsPassed,true);
 assert.equal(evaluate(state([booking],booking),state([booking],booking,[event('1')]),def).databaseAssertionsPassed,false);
});
