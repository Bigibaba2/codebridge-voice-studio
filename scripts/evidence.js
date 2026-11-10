/** Reproducible transcript checks and local HTTP timing. Does not use a microphone. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir,cpus,platform,release} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {Desk} from '../src/desk.js';
import {createService} from '../src/server.js';
const scenarios=JSON.parse(readFileSync(new URL('../tests/scenarios.json',import.meta.url)));
const outcomes=[];
for(const scenario of scenarios){
 const desk=new Desk();
 try{
  let s=desk.createSession();const before=desk.snapshot(),turns=[];
  for(const transcript of scenario.turns){s=desk.turn({sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript,source:'test'});turns.push({transcript,reply:s.reply,status:s.status,draft:s.draft,booking:s.booking,processingMs:s.metrics.processingMs});}
  const after=desk.snapshot();assert.equal(s.status,scenario.expected.status);assert.equal(after.bookings.length-before.bookings.length,scenario.expected.newBookings);
  for(const key of ['itemId','quantity','start','end'])if(scenario.expected[key]!==undefined)assert.equal(s.booking[key],scenario.expected[key]);
  if(scenario.expected.items) assert.deepEqual([...s.booking.items].sort((a,b)=>a.itemId.localeCompare(b.itemId)),[...scenario.expected.items].sort((a,b)=>a.itemId.localeCompare(b.itemId)));
  outcomes.push({...scenario,before,turns,after,passed:true});
 }finally{desk.close();}
}
writeFileSync(new URL('../evidence/transcript-checks.json',import.meta.url),JSON.stringify({recordedAt:new Date().toISOString(),kind:'synthetic-transcript-not-audio',expectedOutcomesSource:'tests/scenarios.json (written before execution)',count:outcomes.length,outcomes},null,2));
const folder=mkdtempSync(path.join(tmpdir(),'studio-benchmark-'));
const service=createService({dbPath:path.join(folder,'bench.sqlite')});
await new Promise(r=>service.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${service.server.address().port}`;
const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status===200||r.status===201,true);return r.json();};
const timings=[];
try{
 for(let i=0;i<100;i++){
  let s=await post('/api/sessions',{});const date=new Date(Date.UTC(2028,0,1+i)).toISOString().slice(0,10);
  let start=performance.now();s=await post('/api/turn',{sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:`one camera from ${date} to ${date}`,source:'test'});const reviewMs=performance.now()-start;assert.equal(s.status,'review');
  start=performance.now();s=await post('/api/turn',{sessionId:s.sessionId,eventId:randomUUID(),expectedRevision:s.revision,transcript:'yes',source:'test'});const bookingMs=performance.now()-start;assert.ok(s.booking);
  timings.push({reviewMs,bookingMs,totalMs:reviewMs+bookingMs});
 }
 const stats=key=>{const values=timings.map(t=>t[key]).sort((a,b)=>a-b);return {median:values[Math.floor(values.length/2)],p95:values[Math.ceil(values.length*.95)-1],min:values[0],max:values.at(-1)};};
 writeFileSync(new URL('../evidence/local-timing.json',import.meta.url),JSON.stringify({recordedAt:new Date().toISOString(),kind:'loopback-HTTP-disk-SQLite-only',sampleCount:100,environment:{node:process.version,platform:platform(),release:release(),cpu:cpus()[0]?.model},summary:{reviewMs:stats('reviewMs'),bookingMs:stats('bookingMs'),totalMs:stats('totalMs')},excluded:['human speech','recognition provider','browser','synthesis','speaker waveform','human decision time'],trueAcousticLatency:null,timings},null,2));
 console.log(`${outcomes.length} transcript checks passed. 100 isolated HTTP/disk booking operations measured. No acoustic claim.`);
}finally{service.server.closeAllConnections();await new Promise(r=>service.server.close(r));service.desk.close();rmSync(folder,{recursive:true,force:true});}
