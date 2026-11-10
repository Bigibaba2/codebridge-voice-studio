import {createHash, randomBytes} from 'node:crypto';
import {Desk, DeskError} from './desk.js';
export const REVIEW_LIMITS=Object.freeze({owners:32,sessions:8,turns:100,ownerRequests:120,globalRequests:600,bodyBytes:8192,ttlMs:30*60*1000,pages:512});
const cookieName='__Host-codebridge-reviewer';
const hash=value=>createHash('sha256').update(value).digest('hex');
/** Temporary synthetic catalogs, never access the local persistent database. */
export class Reviewers {
 constructor({limits={},now=Date.now}={}){this.limits={...REVIEW_LIMITS,...limits};this.now=now;this.owners=new Map();this.window=0;this.requests=0;this.timer=setInterval(()=>this.sweep(),30000);this.timer.unref();}
 sweep(){for(const [key,owner] of this.owners)if(this.now()>=owner.expires){owner.desk.close();this.owners.delete(key);}}
 close(){clearInterval(this.timer);for(const owner of this.owners.values())owner.desk.close();this.owners.clear();}
 resolve(req,res,{create=false}={}){
  this.sweep();const now=this.now(),window=Math.floor(now/60000);
  if(this.window!==window){this.window=window;this.requests=0;}
  if(++this.requests>this.limits.globalRequests)throw new DeskError('Demo traffic limit reached. Try again in one minute.',429);
  const values=String(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(cookieName+'=')).map(s=>s.slice(cookieName.length+1));
  const token=values.length===1&&/^[a-f0-9]{64}$/.test(values[0])?values[0]:null;
  let owner=token?this.owners.get(hash(token)):null;
  if(!owner){
   if(!create)throw new DeskError('Temporary demo workspace expired or unavailable. Start a new conversation. Previous demo bookings are not recoverable here.',410);
   if(this.owners.size>=this.limits.owners)throw new DeskError('Demo is at capacity. Try again after a workspace expires (up to 30 minutes).',503);
   const fresh=randomBytes(32).toString('hex'),desk=new Desk(':memory:');
   desk.db.exec(`PRAGMA max_page_count=${this.limits.pages}`);
   owner={desk,expires:now+this.limits.ttlMs,window,requests:0,sessions:0,turns:0};this.owners.set(hash(fresh),owner);
   res.setHeader('Set-Cookie',`${cookieName}=${fresh}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(this.limits.ttlMs/1000)}`);
  }
  if(owner.window!==window){owner.window=window;owner.requests=0;}
  if(++owner.requests>this.limits.ownerRequests)throw new DeskError('Workspace request limit reached. Try again in one minute.',429);
  return owner;
 }
 createSession(owner){if(owner.sessions>=this.limits.sessions)throw new DeskError('Temporary workspace conversation limit reached. Return after this workspace expires.',429);const s=owner.desk.createSession();owner.sessions++;return s;}
 turn(owner,body){
  // Resolve ownership before any replay or revision error can reveal state.
  if(typeof body?.sessionId==='string')owner.desk.session(body.sessionId);
  const replay=typeof body?.eventId==='string'&&typeof body?.sessionId==='string'&&owner.desk.db.prepare('SELECT 1 FROM events WHERE session_id=? AND id=?').get(body.sessionId,body.eventId);
  if(!replay&&owner.turns>=this.limits.turns)throw new DeskError('Temporary workspace turn limit reached. Return after this workspace expires.',429);
  const result=owner.desk.turn(body);if(!result.replayed)owner.turns++;return result;
 }
}
