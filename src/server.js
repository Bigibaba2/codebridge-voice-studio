import http from 'node:http';
import {isIP} from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Desk,DeskError} from './desk.js';
import {Reviewers,REVIEW_LIMITS} from './reviewers.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function readBody(req,limit,deadlineMs=10000){
 return new Promise((resolve,reject)=>{
  let size=0;const chunks=[];
  const cleanup=()=>{clearTimeout(timer);req.off('data',data);req.off('end',end);req.off('error',fail);req.off('aborted',aborted);};
  const fail=error=>{cleanup();req.pause();reject(error);};
  const aborted=()=>fail(new DeskError('Request interrupted.',400));
  const data=chunk=>{size+=chunk.length;if(size>limit)return fail(new DeskError('Request too large.',413));chunks.push(chunk);};
  const end=()=>{cleanup();resolve(Buffer.concat(chunks).toString('utf8'));};
  const timer=setTimeout(()=>fail(new DeskError('Request body deadline exceeded.',408)),deadlineMs);
  req.on('data',data);req.on('end',end);req.on('error',fail);req.on('aborted',aborted);
 });
}
export function createService({dbPath=':memory:',reviewerMode=false,reviewerOptions={},bodyDeadlineMs=10000}={}) {
 const reviewers=reviewerMode?new Reviewers(reviewerOptions):null;
 const desk=reviewers?null:new Desk(dbPath);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/api/')){
    if(req.method==='GET'&&url.pathname==='/api/config')return json(200,{version:'2.1.0',reservationMode:'multi-item-shared-dates',mode:reviewers?'temporary-reviewer-demo':'isolated-demo',temporary:!!reviewers,voice:'browser-native',seed:'2026-10-10 through 2026-10-12 inclusive'});
    if(req.method==='GET'&&url.pathname==='/api/state')return json(200,(reviewers?reviewers.resolve(req,res).desk:desk).snapshot());
    if(req.method==='GET'&&/^\/api\/sessions\/[a-f0-9-]+$/.test(url.pathname))return json(200,(reviewers?reviewers.resolve(req,res).desk:desk).state(url.pathname.split('/').pop()));
    if(req.method!=='POST')return json(405,{error:'Method not allowed.'});
    if(reviewers&&req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Cross-site writes are not allowed.'});
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(403,{error:'Cross-origin writes are not allowed.'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(415,{error:'Use application/json.'});
    const limit=reviewers?REVIEW_LIMITS.bodyBytes:32768;
    if(Number(req.headers['content-length'])>limit)throw new DeskError('Request too large.',413);
    const raw=await readBody(req,limit,bodyDeadlineMs);
    let body;try{body=JSON.parse(raw||'{}');}catch{throw new DeskError('Invalid JSON.');}
    if(url.pathname==='/api/sessions')return json(201,reviewers?reviewers.createSession(reviewers.resolve(req,res,{create:true})):desk.createSession());
    if(url.pathname==='/api/turn')return json(200,reviewers?reviewers.turn(reviewers.resolve(req,res),body):desk.turn(body));
    return json(404,{error:'Not found.'});
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
   let relative;try{relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);}catch{res.writeHead(400);return res.end('Invalid path');}
   const file=path.resolve(root,'public',relative);
   if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  }catch(e){if(e instanceof DeskError){if([408,413].includes(e.status))res.setHeader('Connection','close');return json(e.status,{error:e.message,...(e.state?{state:e.state}:{})});}if(!reviewers)console.error(e);json(500,{error:'The request failed. Reload the conversation to inspect saved state before retrying.'});}
 });
 server.requestTimeout=11000;server.headersTimeout=10000;server.timeout=12000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
 server.maxConnections=64;
 const close=()=>reviewers?reviewers.close():desk.close();
 return {server,desk,reviewers,close};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const reviewerMode=process.env.REVIEWER_MODE==='1';
 const host=process.env.HOST||'127.0.0.1';
 const loopback=host==='localhost'||host==='::1'||(isIP(host)===4&&host.startsWith('127.'));
 if(!loopback&&!reviewerMode){console.error('Refusing a non-loopback listener without REVIEWER_MODE=1. Local shared state must not be exposed.');process.exit(1);}
 const dbPath=process.env.DB_PATH||path.join(root,'data','studio.sqlite');if(!reviewerMode)fs.mkdirSync(path.dirname(dbPath),{recursive:true});
 const {server,close}=createService({dbPath,reviewerMode});const port=Number(process.env.PORT)||3010;
 server.listen(port,host,()=>console.log(`Voice Studio: http://${host}:${port}\nStorage: ${reviewerMode?'temporary isolated reviewer memory':dbPath}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{close();process.exit(0);}));
}
