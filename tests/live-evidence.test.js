import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../scripts/live-check.js';
const booking={id:'BK-EXAMPLE',itemId:'tripod',quantity:2,start:'2026-11-14',end:'2026-11-16'};
const state=(events=[],bookings=[booking])=>({database:{bookings},session:{booking,events:events.map(e=>({...e,status:'booked'})),status:'booked'},rawEvents:events.map(e=>({id:e.id,request:{transcript:e.text,source:e.source}}))});
test('repeat evidence requires two actual new voice-labelled confirmations and unchanged booking',()=>{
 const before=state();const after=state([{id:'1',text:'confirm booking',source:'voice'},{id:'2',text:'book it',source:'voice'}]);
 const result=evaluate(before,after,{id:'repeat'});assert.equal(result.databaseAssertionsPassed,true);assert.equal(result.recordingVerified,false);assert.equal(result.acousticLatencyMs,null);
});
test('buttons or unrelated speech cannot masquerade as repeated voice confirmations',()=>{
 for(const source of ['button','voice']){
  const before=state(),after=state([{id:'1',text:source==='voice'?'hello':'confirm booking',source},{id:'2',text:source==='voice'?'hi':'confirm booking',source}]);
  assert.equal(evaluate(before,after,{id:'repeat'}).databaseAssertionsPassed,false);
 }
});
test('duplicate reservation fails evidence evaluation',()=>{
 const before=state(),after=state([{id:'1',text:'yes',source:'voice'},{id:'2',text:'yes',source:'voice'}],[booking,{...booking,id:'BK-DUPLICATE'}]);
 assert.equal(evaluate(before,after,{id:'repeat'}).databaseAssertionsPassed,false);
});
