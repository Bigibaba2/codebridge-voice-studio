import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretOrder as parse} from '../src/order-interpret.js';
const items=[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2},{itemId:'microphone',quantity:1}];
const draft={items,start:'2026-11-14',end:'2026-11-16'};
const sorted=x=>[...x].sort((a,b)=>a.itemId.localeCompare(b.itemId));
test('one reservation with all three explicitly counted equipment lines and shared dates',()=>{
 const r=parse('one camera A, two tripod B and one microphone C from November 14 to November 16 2026');
 assert.equal(r.issue,undefined);assert.deepEqual(r.patch,{...draft});
});
test('individually grounded missing quantities and number-one reply',()=>{
 const first=parse('camera A and tripod B from November 14 to 16 2026');
 assert.equal(first.pending.itemId,'camera');
 assert.deepEqual(first.patch.items,[{itemId:'camera',quantity:null},{itemId:'tripod',quantity:null}]);
 const second=parse('number one',{draft:first.patch,pending:first.pending});
 assert.equal(second.pending.itemId,'tripod');
 const third=parse('two',{draft:{...first.patch,...second.patch},pending:second.pending});
 assert.deepEqual(third.patch.items,[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2}]);
 assert.equal(third.issue,undefined);
});
test('missing year remains grounded then quantity is clarified',()=>{
 const first=parse('camera and two tripods from November 14 to 16');
 assert.equal(first.pending.kind,'year');
 const second=parse('twenty twenty seven',{draft:first.patch,pending:first.pending});
 assert.deepEqual(second.patch,{start:'2027-11-14',end:'2027-11-16'});
 assert.equal(second.pending.itemId,'camera');
});
test('named additions corrections and removals preserve other lines',()=>{
 const added=parse('add one microphone C',{draft:{items:items.slice(0,2)}});
 assert.deepEqual(sorted(added.patch.items),sorted(items));
 const updated=parse('actually three tripods',{draft});
 assert.equal(updated.patch.items.find(x=>x.itemId==='tripod').quantity,3);
 const changed=parse('change Camera A to two',{draft});
 assert.equal(changed.patch.items.find(x=>x.itemId==='camera').quantity,2);
 const removed=parse('remove tripod B',{draft});
 assert.deepEqual(removed.patch.items,items.filter(x=>x.itemId!=='tripod'));
 const negated=parse('not a camera',{draft});
 assert.equal(negated.patch.items.some(x=>x.itemId==='camera'),false);
});
test('bare count is ambiguous with multiple items but grounded with one line',()=>{
 assert.equal(parse('three',{draft}).issue.slot,'quantity');
 assert.equal(parse('three',{draft:{items:[items[0]]}}).patch.items[0].quantity,3);
});
test('duplicate and contradictory mentions are not summed or silently resolved',()=>{
 for(const text of ['one camera and two cameras','one camera and one camera','remove camera and add two cameras']) {
  const r=parse(text,{draft});assert.equal(r.issue.slot,'quantity',text);
  assert.equal(r.patch.items.find(x=>x.itemId==='camera')?.quantity??null,null,text);
 }
});
test('unsupported items cannot disappear from mixed orders',()=>{
 for(const text of ['one camera and two drones','one camera and two drones and one tripod','one camera plus a banana','one camera and one tripod deluxe']) assert.ok(parse(text,{draft}).issue,text);
});
test('conditions and broad negation cannot confirm or preserve stale order',()=>{
 assert.deepEqual(parse('yes if it is free',{draft}).patch,{items:[],start:null,end:null});
 assert.equal(parse('never reserve a camera',{draft}).patch.items.some(x=>x.itemId==='camera'),false);
 assert.equal(parse('yes',{draft}).intent,'confirm');
 assert.equal(parse('review booking',{draft}).question,'status');
});
test('date changes are shared and ambiguous dates cannot become a guessed range',()=>{
 assert.deepEqual(parse('change dates to December 2 through 4 2026',{draft}).patch,{start:'2026-12-02',end:'2026-12-04'});
 assert.equal(parse('one camera and two tripods from November 22 November 22 2026').issue.slot,'dates');
 assert.equal(parse('one camera and two tripods from 11/14/2026 to 11/16/2026').issue.slot,'dates');
});
test('people counts and multiplier quantities are not booked as item counts',()=>{
 const r=parse('camera for two people from November 14 to 16 2026');
 assert.equal(r.pending.retainedItems[0].quantity,null);
 assert.ok(parse('two dozen cameras and one tripod').issue);
});
test('unknown equipment count survives explicit meaning clarification without a null-id line',()=>{
 const first=parse('two tree pots from November 14 to 16 2026');
 assert.equal(first.issue.slot,'itemId');assert.equal(first.pending.quantity,2);
 assert.deepEqual(first.patch,{start:'2026-11-14',end:'2026-11-16',items:[]});
 const second=parse('tripod B',{draft:first.patch,pending:first.pending});
 assert.deepEqual(second.patch.items,[{itemId:'tripod',quantity:2}]);
 const mixed=parse('one camera and two tree pots');
 assert.equal(mixed.pending.quantity,2);
 const resolved=parse('tripod',{draft:mixed.patch,pending:mixed.pending});
 assert.deepEqual(sorted(resolved.patch.items),sorted([{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2}]));
});
test('unrelated date answers cannot revive a draft with unresolved equipment',()=>{
 const first=parse('add two tree pots',{draft});
 assert.deepEqual(first.patch.items,[]);
 const next=parse('December 2 to 4 2026',{draft:{...draft,...first.patch},pending:first.pending});
 assert.deepEqual(next.patch.items,[]);assert.equal(next.issue.slot,'itemId');
 assert.equal(next.pending.quantity,2);
 const resolved=parse('tripod',{draft:{...draft,...next.patch},pending:next.pending});
 assert.equal(resolved.issue,undefined);
 assert.equal(resolved.patch.items.find(x=>x.itemId==='tripod').quantity,2);
});
test('quantity issue targets a line and cannot revive through a date-only change',()=>{
 const first=parse('two dozen cameras',{draft});
 assert.equal(first.issue.itemId,'camera');
 assert.equal(first.patch.items.find(x=>x.itemId==='camera').quantity,null);
 const next=parse('December 2 to 4 2026',{draft:{...draft,...first.patch},pending:first.pending});
 assert.equal(next.issue.slot,'quantity');assert.equal(next.pending.itemId,'camera');
});
test('unknown noun count cannot masquerade as a count-only answer',()=>{
 const r=parse('two treepots',{draft:{items:[items[0]]}});
 assert.equal(r.issue.slot,'itemId');assert.deepEqual(r.patch.items,[]);
 assert.equal(r.pending.quantity,2);
});
test('list removal scopes to each named line and explicit add changes that scope',()=>{
 assert.deepEqual(parse('remove camera and tripod',{draft}).patch.items,[items[2]]);
 const changed=parse('remove camera and add three tripods',{draft});
 assert.equal(changed.patch.items.some(x=>x.itemId==='camera'),false);
 assert.equal(changed.patch.items.find(x=>x.itemId==='tripod').quantity,3);
});
test('terminal punctuation does not turn a booking request into an information question',()=>{
 for(const text of ['Could you set aside a camera from October 13 to 15, 2026?','Can I rent two cameras from October 10 to 12, 2026?','I need one camera and two tripods from November 14 to 16 2026?']) {
  const r=parse(text);assert.equal(r.intent,'update',text);assert.equal(r.issue,undefined,text);assert.ok(r.patch.items.length);
 }
 assert.equal(parse('Are cameras available?').intent,'question');
});
test('unrecognized noise remains unknown without destructive draft changes',()=>{
 for(const text of ['Ron','guess','number run']) assert.deepEqual(parse(text,{draft:{items:[{itemId:'tripod',quantity:null}]},pending:{kind:'quantity',itemId:'tripod',slot:'quantity'}}),{intent:'unknown',patch:{}});
});
test('catalog homophone requests meaning-only confirmation with grounded canonical suggestion',()=>{
 const r=parse('two tripod be from November14 to16 2026');
 assert.match(r.issue.prompt,/Do you mean Tripod B/);
 assert.deepEqual(r.patch,{items:[],start:'2026-11-14',end:'2026-11-16'});
 assert.equal(r.pending.kind,'suggestion');
 assert.deepEqual(r.pending.patch,{items:[{itemId:'tripod',quantity:2}]});
 assert.equal(parse('yes',{draft:r.patch,pending:r.pending}).intent,'confirm');
});
test('simultaneous quantity and invalid-date replacement revokes both before prompting',()=>{
 const original={items:[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:1}],start:'2027-01-01',end:'2027-01-02'};
 const first=parse('two dozen cameras from November 31 to December 2 2027',{draft:original});
 assert.equal(first.issue.slot,'quantity');assert.equal(first.patch.start,null);assert.equal(first.patch.end,null);
 const nextDraft={...original,...first.patch};
 const next=parse('one',{draft:nextDraft,pending:first.pending});
 assert.equal(({...nextDraft,...next.patch}).start,null);
 assert.equal(({...nextDraft,...next.patch}).end,null);
});
test('simultaneous quantity and missing-year replacement keeps year clarification after quantity',()=>{
 const first=parse('two dozen cameras from November 14 to 16',{draft});
 assert.equal(first.patch.start,null);assert.equal(first.patch.end,null);
 assert.equal(first.pending.deferredYear.kind,'year');
 const second=parse('one',{draft:{...draft,...first.patch},pending:first.pending});
 assert.equal(second.issue.slot,'year');
 const third=parse('2027',{draft:{...draft,...first.patch,...second.patch},pending:second.pending});
 assert.deepEqual(third.patch,{start:'2027-11-14',end:'2027-11-16'});
});
test('natural named quantity corrections preserve every other line and shared date',()=>{
 for(const text of ['Change the tripods to one','change tripod B to one','set the tripod quantity to one']) {
  const r=parse(text,{draft});assert.equal(r.issue,undefined,text);
  assert.equal(r.patch.items.find(x=>x.itemId==='tripod').quantity,1,text);
  assert.deepEqual(r.patch.items.filter(x=>x.itemId!=='tripod'),items.filter(x=>x.itemId!=='tripod'));
  assert.equal(r.patch.start,undefined);assert.equal(r.patch.end,undefined);
 }
 assert.equal(parse('make the camera two',{draft}).patch.items.find(x=>x.itemId==='camera').quantity,2);
});
test('only and replace cannot silently preserve unwanted old equipment',()=>{
 for(const text of ['only a camera instead','replace the tripod with a microphone']) {
  const r=parse(text,{draft});assert.deepEqual(r.patch.items,[],text);assert.equal(r.issue.slot,'items');
  assert.equal(r.patch.start,undefined);assert.equal(r.patch.end,undefined);
  const next=parse('camera',{draft:{...draft,...r.patch},pending:r.pending});
  assert.equal(next.patch.items.some(x=>x.itemId==='tripod'),false);
  assert.equal(next.patch.items[0].quantity,null);
 }
});
test('unsupported per-item dates revoke every mentioned quantity and the shared date range',()=>{
 const r=parse('two cameras for December14 and one tripod for December15 2026',{draft});
 assert.equal(r.issue.slot,'dates');assert.equal(r.patch.start,null);assert.equal(r.patch.end,null);
 assert.equal(r.patch.items.find(x=>x.itemId==='camera').quantity,null);
 assert.equal(r.patch.items.find(x=>x.itemId==='tripod').quantity,null);
 const next=parse('December 14 to 15 2026',{draft:{...draft,...r.patch}});
 assert.equal(next.issue.slot,'quantity');
});
function applyOrderResult(state,result) {
 return {draft:{...state.draft,...result.patch},pending:result.pending??(result.intent==='confirm'||result.intent==='unknown'?state.pending:null)};
}
function retainedLines(state) {return state.pending?.retainedItems||state.draft.items||[];}
test('exact live noisy first line never drops explicitly requested Camera A',()=>{
 let state={draft:{items:[],start:null,end:null},pending:null};
 const turns=['phone camera a to tripod B and 1 microphone C from December 17th to December 19th 2026','change a tripods to V','change the tripods to Von','yes tripod B 1','yes'];
 for(const text of turns) {
  const r=parse(text,state);state=applyOrderResult(state,r);
  const lines=retainedLines(state);
  assert.equal(lines.length,3,text);
  assert.equal(lines.find(x=>x.itemId==='camera').quantity,null,text);
  assert.equal(lines.find(x=>x.itemId==='microphone').quantity,1,text);
  if(text.includes('to V'))assert.equal(lines.find(x=>x.itemId==='tripod').quantity,null,text);
 }
 assert.equal(retainedLines(state).find(x=>x.itemId==='tripod').quantity,1);
});
test('unclear first middle and last counts preserve every named line until explicit resolution',()=>{
 for(const [text,unresolved] of [
  ['phone camera and two tripods and one microphone from December 17 to 19 2026','camera'],
  ['one camera and Von tripods and one microphone from December 17 to 19 2026','tripod'],
  ['one camera and two tripods and V microphone from December 17 to 19 2026','microphone']
 ]) {
  let state={draft:{items:[]}};
  let r=parse(text,state);state=applyOrderResult(state,r);
  assert.equal(retainedLines(state).length,3,text);
  assert.equal(retainedLines(state).find(x=>x.itemId===unresolved).quantity,null,text);
  const other=unresolved==='camera'?'tripod':'camera';
  r=parse(`two ${other}`,state);state=applyOrderResult(state,r);
  assert.equal(retainedLines(state).find(x=>x.itemId===unresolved).quantity,null,text);
  r=parse('December 20 to 22 2026',state);state=applyOrderResult(state,r);
  assert.equal(retainedLines(state).find(x=>x.itemId===unresolved).quantity,null,text);
  r=parse('yes',state);assert.equal(r.intent,'confirm');
  assert.equal(retainedLines(state).find(x=>x.itemId===unresolved).quantity,null,text);
  r=parse(`one ${unresolved}`,state);state=applyOrderResult(state,r);
  assert.equal(retainedLines(state).length,3);
  assert.equal(retainedLines(state).find(x=>x.itemId===unresolved).quantity,1);
 }
});
test('meaning-only suggestions preserve other unresolved named lines',()=>{
 const r=parse('phone camera and two tripod be from December 17 to 19 2026');
 const lines=r.pending.retainedItems;
 assert.equal(lines.find(x=>x.itemId==='camera').quantity,null);
 assert.equal(lines.find(x=>x.itemId==='tripod').quantity,2);
 const next=parse('one microphone',{draft:r.patch,pending:r.pending});
 assert.equal(next.patch.items.find(x=>x.itemId==='camera').quantity,null);
 assert.equal(next.issue.slot,'quantity');
});
test('explicit removal can remove an unresolved line but unrelated confirmation cannot',()=>{
 const r=parse('phone camera and one tripod from December 17 to 19 2026');
 const removed=parse('remove camera',{draft:r.patch,pending:r.pending});
 assert.deepEqual(removed.patch.items,[{itemId:'tripod',quantity:1}]);
 assert.equal(removed.issue,undefined);
});
test('plural items ASR clarification retains all unresolved lines through named answers',()=>{
 const retainedItems=[{itemId:'camera',quantity:null},{itemId:'tripod',quantity:null},{itemId:'microphone',quantity:1}];
 const pending={kind:'suggestion',slot:'items',prompt:'Which items did you mean?',retainedItems,patch:{items:retainedItems}};
 const state={draft:{items:[],start:'2026-12-17',end:'2026-12-19'},pending};
 const result=parse('yes tripod B 1',state);
 assert.equal(result.patch.items.length,3);
 assert.equal(result.patch.items.find(x=>x.itemId==='camera').quantity,null);
 assert.equal(result.patch.items.find(x=>x.itemId==='tripod').quantity,1);
 assert.equal(result.patch.items.find(x=>x.itemId==='microphone').quantity,1);
 assert.equal(result.issue.slot,'quantity');assert.equal(result.pending.itemId,'camera');
});
test('date-only answers keep plural item clarification blocked and preserve retained lines',()=>{
 const retainedItems=[{itemId:'camera',quantity:null},{itemId:'tripod',quantity:1}];
 const pending={kind:'clarify',slot:'items',retainedItems,prompt:'Please clarify the equipment list.'};
 for(const text of ['December 20 to 22 2026','December 31 to December 32 2026','December 20 to 22']) {
  const result=parse(text,{draft:{items:[],start:'2026-01-01',end:'2026-01-02'},pending});
  assert.equal(result.issue.slot,'items',text);assert.deepEqual(result.patch.items,[],text);
  assert.deepEqual(result.pending.retainedItems,retainedItems,text);
  if(text!=='December 20 to 22 2026') {assert.equal(result.patch.start,null);assert.equal(result.patch.end,null);}
  if(text==='December 20 to 22')assert.equal(result.pending.deferredYear.kind,'year');
 }
});
test('plural unresolved item clarification preserves grounded unknown quantity on named answer',()=>{
 const result=parse('tripod',{draft:{items:[]},pending:{kind:'clarify',slot:'items',retainedItems:[{itemId:'camera',quantity:null}],quantity:2}});
 assert.deepEqual(result.patch.items,[{itemId:'camera',quantity:null},{itemId:'tripod',quantity:2}]);
 assert.equal(result.pending.itemId,'camera');
});
test('misheard month inside an explicit date clause asks dates without discarding grounded equipment',()=>{
 for(const text of [
  'two tripod B from the summer 20 to December 22 2026',
  'two tripods from the member 20 to December 22 2026',
  'two tripods for the summer 20 through December 22 2026',
  'two tripods from the summer twentieth to December twenty second 2026',
  'two tripods from December 20 to the summer 22 2026',
  'one camera and two tripods from the summer 20 to December 22 2026'
 ]) {
  const r=parse(text,{draft});assert.equal(r.issue.slot,'dates',text);
  assert.equal(r.patch.items.find(x=>x.itemId==='tripod').quantity,2,text);
  assert.equal(r.patch.start,null,text);assert.equal(r.patch.end,null,text);
  assert.equal(r.pending?.kind==='suggestion',false,text);
  assert.doesNotMatch(r.issue.prompt,/name each item|equipment list/i,text);
 }
});
test('uncertain date clauses do not hide actual unsupported equipment nouns',()=>{
 for(const text of ['two tripods and a laptop from the summer 20 to December 22 2026','one camera and two drones from the summer 20 to December 22 2026']) {
  const r=parse(text,{draft});assert.equal(r.issue.slot,'itemId',text);
  assert.deepEqual(r.patch.items,[],text);assert.equal(r.patch.start,null);assert.equal(r.patch.end,null);
  assert.ok(r.pending.retainedItems.length,text);
 }
});
test('uncertain date correction cannot revive old dates through an unrelated quantity answer',()=>{
 const first=parse('two tripod B from the summer 20 to December 22 2026',{draft});
 const nextDraft={...draft,...first.patch};
 const quantity=parse('one tripod',{draft:nextDraft,pending:first.pending});
 assert.equal({...nextDraft,...quantity.patch}.start,null);
 assert.equal({...nextDraft,...quantity.patch}.end,null);
 const corrected=parse('from December 20 to December 22 2026',{draft:{...nextDraft,...quantity.patch}});
 assert.equal(corrected.issue,undefined);assert.equal(corrected.patch.start,'2026-12-20');assert.equal(corrected.patch.end,'2026-12-22');
});
test('ordinary date introducers remain valid and non-date purpose words stay unresolved',()=>{
 assert.equal(parse('two tripods from the December 20 to December 22 2026').issue,undefined);
 assert.equal(parse('two tripods for people').issue.slot,'itemId');
});
test('date-only correction never accepts a recognized end after an uncertain range prefix',()=>{
 for(const text of ['change dates from the summer 20 to December 22 2026','change the end from the summer 20 to December 22 2026']) {
  const r=parse(text,{draft});assert.equal(r.issue.slot,'dates',text);
  assert.equal(r.patch.start,null,text);assert.equal(r.patch.end,null,text);
 }
});
test('unsupported equipment after unclear dates remains blocked across date recovery',()=>{
 for(const text of [
  'two tripods from the summer20 to December22 2026 and a laptop',
  'two tripods from the summer 20 to December 22 2026 plus a slider',
  'two tripods from the summer 20 to December 22 2026 and two sliders',
  'two tripods from the summer 20 to December 22 2026 and 2 sliders',
  'one camera and two tripods from the summer 20 to December 22 2026 and a laptop',
  'two tripods from December 20 to December 22 2026 and a laptop'
 ]) {
  const first=parse(text,{draft});assert.equal(first.issue.slot,'itemId',text);
  assert.deepEqual(first.patch.items,[],text);assert.equal(first.patch.start,null);assert.equal(first.patch.end,null);
  assert.equal(first.pending.retainedItems.find(x=>x.itemId==='tripod').quantity,2,text);
  const second=parse('December 20 to December 22 2026',{draft:{...draft,...first.patch},pending:first.pending});
  assert.equal(second.issue.slot,'itemId',text);assert.deepEqual(second.patch.items,[],text);
  assert.deepEqual(second.pending.retainedItems,first.pending.retainedItems,text);
 }
});
test('conversational prefixes preserve explicit named quantity corrections',()=>{
 const current={items:[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2},{itemId:'microphone',quantity:1}],start:'2026-12-27',end:'2026-12-29'};
 for(const text of ['Actually, change the tripods to one.','Actually change the tripods to one.','Actually, please change the tripods to one.','Please, update the tripod quantity to one.','Wait, set the tripod to one.','Actually, make the tripods one.']) {
  const r=parse(text,{draft:current});assert.equal(r.intent,'update',text);assert.equal(r.issue,undefined,text);
  assert.deepEqual(sorted(r.patch.items),sorted(current.items.map(line=>line.itemId==='tripod'?{...line,quantity:1}:line)),text);
  assert.equal(r.patch.start,undefined,text);assert.equal(r.patch.end,undefined,text);
  assert.deepEqual(current.items,[{itemId:'camera',quantity:1},{itemId:'tripod',quantity:2},{itemId:'microphone',quantity:1}]);
 }
});
test('correction prefixes do not remove uncertainty negation questions or unsupported nouns',()=>{
 for(const text of [
  'Actually, maybe change the tripods to one.',
  'Actually, change the tripods to one if available.',
  'Actually, do not change the tripods to one.',
  'Actually, should I change the tripods to one?',
  'Actually, can you tell me whether to change the tripods to one?',
  'Actually, change the tripods to Von.',
  'Actually, change the tripods to one and a laptop.',
  'Actually, change the laptop to one.'
 ]) {
  const r=parse(text,{draft});
  assert.ok(r.issue || r.intent==='question' || r.intent==='unknown',text);
  assert.notEqual(r.intent,'confirm',text);
 }
});
test('punctuated unknown count in a named correction cannot reuse an old quantity',()=>{
 for(const text of ['Actually, change the tripods to Von.','Change the tripods to Von.','Actually, make the tripods V.']) {
  const r=parse(text,{draft});assert.ok(r.issue,text);
  const retained=r.pending?.retainedItems||r.patch.items;
  assert.equal(retained.find(line=>line.itemId==='tripod').quantity,null,text);
  assert.equal(retained.find(line=>line.itemId==='camera').quantity,1,text);
  assert.equal(retained.find(line=>line.itemId==='microphone').quantity,1,text);
 }
});
test('incomplete named correction withdraws only its old quantity in review and missing-date contexts',()=>{
 for(const current of [draft,{...draft,start:null,end:null}]) {
  for(const text of ['Change the Tripod','Actually, change the tripod.','Set the tripods','Update tripod B','Make the tripod','change the tripod quantity','change the tripod to','Actually, please update the tripod quantity to']) {
   const r=parse(text,{draft:current,status:current.start?'review':'collecting'});
   assert.equal(r.issue.slot,'quantity',text);assert.equal(r.issue.itemId,'tripod',text);
   assert.equal(r.pending.itemId,'tripod',text);
   assert.deepEqual(r.patch.items,current.items.map(line=>line.itemId==='tripod'?{...line,quantity:null}:line),text);
   assert.equal(r.patch.start,undefined,text);assert.equal(r.patch.end,undefined,text);
   assert.equal(current.items.find(line=>line.itemId==='tripod').quantity,2);
  }
 }
});
test('incomplete correction never guesses an unspecified target or defeats questions and negation',()=>{
 for(const text of ['change it','Actually, set it','update the quantity','make that']) {
  const r=parse(text,{draft});assert.ok(r.intent==='unknown'||r.issue,text);
  assert.equal(r.patch.items?.find(line=>line.itemId==='tripod')?.quantity,undefined,text);
 }
 for(const text of ['Do not change the tripod','Should I change the tripod?','What happens if I change the tripod?']) {
  const r=parse(text,{draft});assert.ok(r.intent==='question'||r.issue||r.intent==='unknown',text);
  assert.notEqual(r.pending?.kind,'quantity',text);
 }
 const missingYear=parse('one camera and two tripods from December 27 to 29');
 const changed=parse('change the tripod',{draft:missingYear.patch,pending:missingYear.pending});
 assert.equal(changed.pending.deferredYear.kind,'year');
 assert.equal(parse('one',{draft:{...missingYear.patch,...changed.patch},pending:changed.pending}).issue.slot,'year');
});
test('incomplete named correction cannot discharge an unresolved extra-item blocker',()=>{
 for(const slot of ['itemId','items']) {
  const pending={kind:'clarify',slot,retainedItems:[{itemId:'tripod',quantity:2}],prompt:'Which extra item do you mean?'};
  const first=parse('Change the Tripod',{draft:{items:[],start:'2026-12-20',end:'2026-12-22'},pending});
  assert.equal(first.issue.slot,slot);assert.deepEqual(first.patch.items,[]);
  assert.equal(first.pending.retainedItems[0].quantity,null);
  const second=parse('one',{draft:first.patch,pending:first.pending});
  assert.equal(second.issue.slot,slot);assert.deepEqual(second.patch.items,[]);
  assert.equal(second.pending.retainedItems[0].quantity,1);
  const targeted=parse('Change the tripods to one.',{draft:second.patch,pending:second.pending});
  assert.equal(targeted.issue.slot,slot);assert.deepEqual(targeted.patch.items,[]);
  const dates=parse('December 20 to 22 2026',{draft:targeted.patch,pending:targeted.pending});
  assert.equal(dates.issue.slot,slot);assert.deepEqual(dates.patch.items,[]);
 }
});
test('unsupported count-from-to syntax revokes named quantity without changing genuine shared dates',()=>{
 for(const text of ['Change the tripod from two to one','Actually, change the tripod from two to one.','make the tripod from two to one','update tripod B from 2 to 1']) {
  const r=parse(text,{draft});assert.equal(r.issue.slot,'quantity',text);
  assert.equal(r.patch.items.find(line=>line.itemId==='tripod').quantity,null,text);
  assert.equal(r.patch.start,undefined,text);assert.equal(r.patch.end,undefined,text);
 }
 const dateChange=parse('change the tripod from December27 to December29 2026',{draft});
 assert.equal(dateChange.issue,undefined);assert.equal(dateChange.patch.start,'2026-12-27');assert.equal(dateChange.patch.end,'2026-12-29');
});
test('a bare count or targeted correction never resolves an existing unknown extra item',()=>{
 for(const text of ['one','change the tripods to one']) {
  const pending={kind:'clarify',slot:'itemId',retainedItems:[{itemId:'tripod',quantity:2}]};
  const r=parse(text,{draft:{items:[]},pending});
  assert.equal(r.issue.slot,'itemId',text);assert.deepEqual(r.patch.items,[],text);
  assert.equal(r.pending.retainedItems[0].quantity,1,text);
 }
});
