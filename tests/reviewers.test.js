import test from 'node:test';
import assert from 'node:assert/strict';
import {createService} from '../src/server.js';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
async function service(options={},extra={}) {
 const app=createService({reviewerMode:true,reviewerOptions:options,...extra});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,{cookie,body,method,headers={}}={})=>{
  const r=await fetch(base+path,{method:method||(body!==undefined?'POST':'GET'),headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  return {status:r.status,headers:r.headers,data:await r.json()};
 };
 const owner=async()=>{const r=await call('/api/sessions',{body:{}});assert.equal(r.status,201);return {cookie:r.headers.get('set-cookie').split(';')[0],state:r.data,headers:r.headers};};
 return {...app,base,call,owner,stop:async()=>{app.server.closeAllConnections();await new Promise(r=>app.server.close(r));app.close();}};
}
const turn=(state,text,eventId=randomUUID())=>({sessionId:state.sessionId,eventId,expectedRevision:state.revision,transcript:text,source:'test'});
test('two reviewers cannot read, mutate, replay, or leak each other through conflicts; catalogs are independent',async()=>{
 const app=await service();try{
  const a=await app.owner(),b=await app.owner();
  assert.match(a.headers.get('set-cookie'),/^__Host-codebridge-reviewer=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800$/);
  assert.ok(!JSON.stringify(a.state).includes(a.cookie.split('=')[1]));
  assert.ok(![...app.reviewers.owners.keys()].includes(a.cookie.split('=')[1]));
  let input=turn(a.state,'one microphone November 5 through November 6 2026');
  a.state=(await app.call('/api/turn',{cookie:a.cookie,body:input})).data;
  assert.equal(a.state.status,'review');
  const confirmed=turn(a.state,'confirm booking');
  a.state=(await app.call('/api/turn',{cookie:a.cookie,body:confirmed})).data;
  assert.equal(a.state.status,'booked');const reference=a.state.booking.id;
  const attacks=[
   ['/api/sessions/'+a.state.sessionId,{}],
   ['/api/turn',{body:confirmed}],
   ['/api/turn',{body:{...confirmed,transcript:'different content'}}],
   ['/api/turn',{body:turn(a.state,'cancel')}],
  ];
  for(const [path,extra] of attacks){const r=await app.call(path,{cookie:b.cookie,...extra});assert.equal(r.status,404);assert.equal(r.data.state,undefined);assert.ok(!JSON.stringify(r.data).includes(reference));assert.ok(!JSON.stringify(r.data).includes(a.state.sessionId));}
  const replay=await app.call('/api/turn',{cookie:a.cookie,body:confirmed});assert.equal(replay.data.replayed,true);assert.equal(replay.data.bookings.length,2);
  const conflict=await app.call('/api/turn',{cookie:a.cookie,body:{...confirmed,transcript:'other'}});assert.equal(conflict.status,409);assert.equal(conflict.data.state.sessionId,a.state.sessionId);
  const bSnapshot=await app.call('/api/state',{cookie:b.cookie});assert.equal(bSnapshot.data.bookings.length,1);assert.ok(!JSON.stringify(bSnapshot).includes(reference));
  b.state=(await app.call('/api/turn',{cookie:b.cookie,body:turn(b.state,'one microphone November 5 through November 6 2026')})).data;
  b.state=(await app.call('/api/turn',{cookie:b.cookie,body:turn(b.state,'confirm booking')})).data;assert.equal(b.state.status,'booked');
  // Stock is shared between sessions of ONE workspace, and unavailable booking is atomic.
  const a2=(await app.call('/api/sessions',{cookie:a.cookie,body:{}})).data;
  const shortage=await app.call('/api/turn',{cookie:a.cookie,body:turn(a2,'one camera and one microphone November 5 through November 6 2026')});assert.equal(shortage.data.status,'unavailable');
  const denied=await app.call('/api/turn',{cookie:a.cookie,body:turn(shortage.data,'confirm booking')});assert.equal(denied.data.bookings.length,2);assert.equal(denied.data.booking,null);
 }finally{await app.stop();}
});
test('missing, malformed, forged, duplicate, and stale cookies cannot select existing owners',async()=>{
 const app=await service();try{
  const a=await app.owner();
  for(const cookie of [undefined,'__Host-codebridge-reviewer=bad','__Host-codebridge-reviewer='+'f'.repeat(64),a.cookie+'; '+a.cookie,'__Host-codebridge-reviewer=%zz']){
   for(const path of ['/api/state','/api/sessions/'+a.state.sessionId])assert.equal((await app.call(path,{cookie})).status,410);
   const fresh=await app.call('/api/sessions',{cookie,body:{}});assert.equal(fresh.status,201);assert.notEqual(fresh.headers.get('set-cookie').split(';')[0],a.cookie);assert.equal(fresh.data.bookings.length,1);
  }
 }finally{await app.stop();}
});
test('absolute expiry and process restart return explicit lost-workspace response, then allow a new catalog',async()=>{
 let now=100000;let app=await service({now:()=>now,limits:{ttlMs:1000}});let a;
 try{
  a=await app.owner();now+=1000;
  const stale=await app.call('/api/turn',{cookie:a.cookie,body:turn(a.state,'confirm booking')});assert.equal(stale.status,410);assert.match(stale.data.error,/not recoverable/);assert.equal(app.reviewers.owners.size,0);
  const fresh=await app.call('/api/sessions',{cookie:a.cookie,body:{}});assert.equal(fresh.status,201);assert.notEqual(fresh.data.sessionId,a.state.sessionId);
 }finally{await app.stop();}
 app=await service();try{assert.equal((await app.call('/api/sessions/'+a.state.sessionId,{cookie:a.cookie})).status,410);assert.equal((await app.call('/api/sessions',{cookie:a.cookie,body:{}})).status,201);}finally{await app.stop();}
});
test('finite owner, session, turn, page, request limits and quota recovery',async()=>{
 let now=100000;let app=await service({now:()=>now,limits:{owners:1,sessions:1,turns:1,ttlMs:1000}});
 try{
  const a=await app.owner();assert.equal((await app.call('/api/sessions',{body:{}})).status,503);assert.equal((await app.call('/api/sessions',{cookie:a.cookie,body:{}})).status,429);
  assert.equal([...app.reviewers.owners.values()][0].desk.db.prepare('PRAGMA max_page_count').get().max_page_count,512);
  const input=turn(a.state,'one camera');assert.equal((await app.call('/api/turn',{cookie:a.cookie,body:input})).status,200);
  assert.equal((await app.call('/api/turn',{cookie:a.cookie,body:input})).data.replayed,true);
  assert.equal((await app.call('/api/turn',{cookie:a.cookie,body:{...input,eventId:randomUUID(),expectedRevision:1}})).status,429);
  now+=1000;assert.equal((await app.call('/api/sessions',{body:{}})).status,201);
 }finally{await app.stop();}
 app=await service({now:()=>now,limits:{ownerRequests:2,globalRequests:4}});try{
  const a=await app.owner();assert.equal((await app.call('/api/state',{cookie:a.cookie})).status,200);assert.equal((await app.call('/api/state',{cookie:a.cookie})).status,429);
  assert.equal((await app.call('/api/state')).status,410);assert.equal((await app.call('/api/state')).status,429);
  now+=60000;assert.equal((await app.call('/api/state',{cookie:a.cookie})).status,200);
 }finally{await app.stop();}
});
test('JSON validation, byte caps, cross-origin writes and internal errors do not expose state',async()=>{
 const app=await service();try{
  const a=await app.owner();
  for(const [body,status] of [['{',400],['null',400],['[]',400],['"x"',400],['x'.repeat(8193),413],['"'+'界'.repeat(3000)+'"',413]])assert.equal((await app.call('/api/turn',{cookie:a.cookie,body})).status,status);
  assert.equal((await app.call('/api/sessions',{cookie:a.cookie,body:{},headers:{Origin:'https://evil.test'}})).status,403);
  assert.equal((await app.call('/api/sessions',{cookie:a.cookie,body:{},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await app.call('/api/sessions',{cookie:a.cookie,body:{},headers:{'Content-Type':'text/plain'}})).status,415);
  const chunked=await new Promise((resolve,reject)=>{const r=request(app.base+'/api/turn',{method:'POST',headers:{Cookie:a.cookie,'Content-Type':'application/json'}},res=>{let raw='';res.on('data',b=>raw+=b);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});r.on('error',reject);r.write('x'.repeat(5000));r.end('x'.repeat(5000));});assert.equal(chunked.status,413);
  const owner=[...app.reviewers.owners.values()][0];owner.desk.snapshot=()=>{throw new Error('PRIVATE SECRET RAW ASR');};
  const r=await app.call('/api/state',{cookie:a.cookie});assert.equal(r.status,500);assert.ok(!JSON.stringify(r).includes('PRIVATE'));assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal(app.server.requestTimeout,11000);assert.equal(app.server.maxConnections,64);
 }finally{await app.stop();}
});

test('slow chunked body has absolute deadline and JSON 408 without allocating workspace',async()=>{
 const app=await service({}, {bodyDeadlineMs:40});
 try{
  const result=await new Promise((resolve,reject)=>{
   const req=request(app.base+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'}},res=>{
    let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{req.destroy();resolve({status:res.statusCode,data:JSON.parse(raw)});});
   });req.on('error',reject);req.write('{');
  });assert.equal(result.status,408);assert.equal(app.reviewers.owners.size,0);
 }finally{await app.stop();}
});

test('reviewer mode never opens the supplied persistent database path',()=>{
 const app=createService({reviewerMode:true,dbPath:'/nonexistent-codebridge-path/must-not-open.sqlite'});
 try{assert.equal(app.desk,null);assert.equal(app.reviewers.owners.size,0);}finally{app.close();}
});

test('CLI fails closed on non-loopback HOST before opening database or listening',()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'codebridge-startup-guard-'));
 try{
  for(const host of ['0.0.0.0','::','192.0.2.1','127.evil.invalid']){
   const db=path.join(folder,'must-not-create','studio.sqlite');
   const env={...process.env,HOST:host,DB_PATH:db,PORT:'0'};delete env.REVIEWER_MODE;
   const result=spawnSync(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url))],{env,encoding:'utf8',timeout:3000});
   assert.equal(result.status,1);assert.match(result.stderr,/Refusing a non-loopback listener/);assert.ok(!result.stdout.includes('Voice Studio:'));assert.equal(existsSync(path.dirname(db)),false);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
