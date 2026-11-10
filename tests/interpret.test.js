import test from 'node:test';
import assert from 'node:assert/strict';
import {interpret,validDate} from '../src/interpret.js';
const full={itemId:'camera',quantity:2,start:'2026-11-14',end:'2026-11-16'};
const parse=t=>interpret(t);
test('natural composed booking requests, including non-native filler and compact dates',()=>{
 for(const text of ['I need two number tripod B from November 14th to November16th2026','Could you please reserve two tripods from November fourteenth to November sixteenth, 2026?','For my shoot, I would love two tripods from November 14 to 16 2026']) {
 assert.deepEqual(parse(text).patch,{itemId:'tripod',quantity:2,start:'2026-11-14',end:'2026-11-16'},text);
 assert.equal(parse(text).issue,undefined,text);
 }
});
test('ordinary polite request wrappers are not questions',()=>{
 for(const text of ['Could you set aside a camera from October 13 to 15, 2026?','Can I rent a camera from October 13 to 15, 2026?']) assert.deepEqual(parse(text).patch,{itemId:'camera',quantity:1,start:'2026-10-13',end:'2026-10-15'});
});
test('grounded quantity only, with natural correction',()=>{
 assert.deepEqual(parse('tripod B').patch,{itemId:'tripod'});
 assert.deepEqual(parse('a camera').patch,{itemId:'camera',quantity:1});
 assert.equal(parse('I need twenty-one tripods').patch.quantity,21);
 assert.equal(interpret('I need two, please',{draft:{itemId:'camera'}}).patch.quantity,2);
 assert.equal(parse('not two, make that one').patch.quantity,1);
 assert.deepEqual(parse('actually one camera instead').patch,{itemId:'camera',quantity:1});
 assert.equal(parse('I needed to tripod').issue.slot,'quantity');
 assert.equal(parse('I needed two tripod').patch.quantity,2);
 for(const t of ['zero cameras','100 cameras','two hundred cameras','1.5 cameras']) assert.equal(parse(t).issue.slot,'quantity');
});
test('explicit standalone number replies use established quantity context',()=>{
 for(const text of ['number one','number 1','the number is one','one number','one unit','two units please','I need one unit please']) {
  const expected=/two/.test(text)?2:1;
  for(const context of [{draft:{itemId:'tripod'}},{pending:{slot:'quantity',kind:'clarify'}}]) {
   const r=interpret(text,context);assert.equal(r.patch.quantity,expected,text);assert.equal(r.issue,undefined,text);
  }
  assert.equal(parse(text).patch.quantity,undefined,'No item or quantity context: '+text);
 }
});
test('quantity reply grammar does not guess homophones, identifiers, people or dates',()=>{
 const context={draft:{itemId:'tripod'},pending:{slot:'quantity',kind:'clarify'}};
 for(const text of ['Ron','Von','run','phone number one','room number one','one person','two people','November one','number one or two','one and two units','number one point five','number 1.5','one unit for two people']) {
  assert.ok(interpret(text,context).patch.quantity==null,text);
 }
 for(const text of ['number zero','number 100','zero units','100 units'])assert.equal(interpret(text,context).issue.slot,'quantity',text);
});
test('year is never inferred; year followup uses grounded endpoints',()=>{
 const first=parse('One camera from December 4 to 6');
 assert.equal(first.issue.slot,'year'); assert.deepEqual(first.patch,{itemId:'camera',quantity:1});
 assert.deepEqual(interpret('2027',{draft:first.patch,pending:first.pending}).patch,{start:'2027-12-04',end:'2027-12-06'});
 assert.equal(interpret('from December 4 to 6',{draft:full}).issue.slot,'year');
});
test('explicit named and ISO cross-month dates; leap days and inclusive duration',()=>{
 assert.deepEqual(parse('from November 30 to December 2 2026').patch,{start:'2026-11-30',end:'2026-12-02'});
 assert.deepEqual(parse('from 2026-12-31 to 2027-01-02').patch,{start:'2026-12-31',end:'2027-01-02'});
 assert.equal(parse('from February 29 to March 2 2027').issue.slot,'dates');
 assert.equal(validDate('2028-02-29'),true);assert.equal(validDate('2026-02-29'),false);
 assert.equal(parse('from January 1 2026 to January 1 2027').issue,undefined);
 assert.equal(parse('from January 1 2026 to January 2 2027').issue.slot,'dates');
});
test('ambiguous corrections never return stale dates or guess a one-day booking',()=>{
 for(const t of ['Reserve microphone C from November22 November22 2026','change dates to tomorrow','from 11/12/2026 to 11/14/2026','change dates to November','from November 20 to November 18 2026','November 22 2026']) {
 const r=interpret(t,{draft:full});assert.equal(r.issue.slot,'dates',t);assert.equal(r.patch.start,undefined);assert.equal(r.patch.end,undefined);
 }
 assert.deepEqual(interpret('change the end to November 19 2026',{draft:full}).patch,{end:'2026-11-19'});
 assert.deepEqual(parse('November 22 to November 22 2026').patch,{start:'2026-11-22',end:'2026-11-22'});
});
test('confirmation is a separate anchored intent, not a keyword',()=>{
 for(const t of ['yes','yes please','Yes, please','Confirm booking','book it','go ahead and reserve it','that looks right','Yes, book it']) assert.equal(parse(t).intent,'confirm',t);
 for(const t of ['yes but change it to three','yes if it is available','maybe book it','do not book it','not confirmed','yes and a drone','please','.']) assert.notEqual(parse(t).intent,'confirm',t);
});
test('unknown and mixed equipment never silently chooses known equipment',()=>{
 for(const t of ['Reserve tree pot November14th to November15th2026','two drones from December 1 to 3 2026','two cameras and one microphone','two purple tripods','camera B','two cameras and a laptop','two tripods deluxe from November 1 to 3 2026','two tripods and a banana']) assert.equal(parse(t).issue.slot,'itemId',t);
});
test('conditions and alternatives cannot yield a booking patch',()=>{
 for(const t of ['a camera or tripod','if it is free reserve two cameras','maybe one microphone','I am not sure, two cameras']) assert.deepEqual(parse(t).patch,{itemId:null,quantity:null,start:null,end:null});
});
test('questions, repeat, cancel and unrecognized utterances remain side effect free',()=>{
 assert.equal(parse('What equipment do you have?').question,'catalog');
 assert.equal(parse('How much does a camera cost?').question,'cost');
 assert.equal(parse('Are two cameras available?').question,'availability');
 assert.equal(parse('Repeat that').intent,'repeat');
 assert.equal(parse('Cancel the booking').intent,'cancel');
 assert.equal(parse('lorem ipsum').intent,'unknown');
});
test('unknown equipment preserves independently grounded quantities and dates',()=>{
 for(const text of ['Reserve two tree pots from November 14 to November 15 2026','Two tripod be from November 14 to November 15 2026']) {
  const result=parse(text);
  assert.equal(result.issue.slot,'itemId',text);
  assert.deepEqual(result.patch,{quantity:2,start:'2026-11-14',end:'2026-11-15'},text);
 }
});
test('status commands are informational without a question mark',()=>{
 for(const text of ['review booking','review my request','what did I ask for']) assert.equal(parse(text).question,'status',text);
});
test('negated requests never modify dates, even with complete grounded slots',()=>{
 for(const text of ['Do not reserve two cameras from November 1 to 3 2026','I do not want a camera from November 1 to 3 2026','not two cameras from November 1 to 3 2026']) {
  const result=parse(text);assert.deepEqual(result.patch,{itemId:null,quantity:null,start:null,end:null});assert.equal(result.issue.slot,'intent');
 }
 assert.deepEqual(parse('not two, make that one camera from November 1 to 3 2026').patch,{itemId:'camera',quantity:1,start:'2026-11-01',end:'2026-11-03'});
});
test('unclaimed numbers and ambiguous quantities cannot be silently truncated',()=>{
 for(const text of ['two cameras from November 1 to 3 2026 and December 4','two cameras from November 1 to 3 2026 and 4']) assert.equal(parse(text).issue.slot,'dates',text);
 for(const text of ['two and three cameras','two cameras three cameras','-1camera','minus one camera','one half camera','1/2 camera','1.5camera']) {
  const result=parse(text);assert.equal(result.issue.slot,'quantity',text);assert.equal(result.patch.quantity,null);
 }
});
test('spoken years and couple quantities are explicit grounded values',()=>{
 for(const year of ['twenty twenty six','two thousand twenty six','two thousand and twenty six']) {
  assert.deepEqual(parse('a couple of tripods from November first to third '+year).patch,{itemId:'tripod',quantity:2,start:'2026-11-01',end:'2026-11-03'});
 }
 const r=parse('two tripods from November 1 to 3');
 assert.deepEqual(interpret('twenty twenty seven',{draft:r.patch,pending:r.pending}).patch,{start:'2027-11-01',end:'2027-11-03'});
});
test('numbers describing people or rooms are never equipment quantities',()=>{
 for(const text of ['camera for two people from November 14 to 16 2026','need camera for room two from November 14 to 16 2026','three people need camera from November 14 to 16 2026']) {
  const r=parse(text);assert.equal(r.patch.quantity,undefined,text);assert.equal(r.patch.itemId,'camera',text);
 }
 assert.equal(parse('two').patch.quantity,undefined);
 assert.equal(parse('I need two please').patch.quantity,undefined);
 assert.equal(interpret('two',{pending:{kind:'clarify',slot:'quantity'}}).patch.quantity,2);
 assert.equal(interpret('two',{draft:{itemId:'tripod'}}).patch.quantity,2);
});
test('count multipliers cannot leave a misleading quantity in the draft',()=>{
 for(const text of ['two dozen cameras','a pair of cameras','three score cameras','two packs of microphones']) {
  const r=interpret(text,{draft:full});assert.equal(r.issue.slot,'quantity',text);assert.equal(r.patch.quantity,null,text);
 }
});
test('withdrawn equipment and conditional requests explicitly invalidate stale draft fields',()=>{
 for(const text of ['not a camera','no longer a camera','never reserve a camera','I refuse a camera','cancel the camera','review booking but not a camera']) {
  const r=interpret(text,{draft:full});assert.equal(r.issue.slot,'intent',text);assert.deepEqual(r.patch,{itemId:null,quantity:null},text);
 }
 assert.deepEqual(interpret('not those dates',{draft:full}).patch,{start:null,end:null});
 assert.deepEqual(interpret('yes if it is free',{draft:full}).patch,{itemId:null,quantity:null,start:null,end:null});
 const r=parse('not two make that one, but never reserve a camera');
 assert.equal(r.patch.itemId,null);
});
