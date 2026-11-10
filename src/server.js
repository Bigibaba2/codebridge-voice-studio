import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Desk,DeskError} from './desk.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createService({dbPath=':memory:'}={}) {
 const desk=new Desk(dbPath);
 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/api/')){
    if(req.method==='GET'&&url.pathname==='/api/config')return json(200,{version:'2.1.0',reservationMode:'multi-item-shared-dates',mode:'isolated-demo',voice:'browser-native',seed:'2026-10-10 through 2026-10-12 inclusive'});
    if(req.method==='GET'&&url.pathname==='/api/state')return json(200,desk.snapshot());
    if(req.method==='GET'&&/^\/api\/sessions\/[a-f0-9-]+$/.test(url.pathname))return json(200,desk.state(url.pathname.split('/').pop()));
    if(req.method!=='POST')return json(405,{error:'Method not allowed.'});
    if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)return json(403,{error:'Cross-origin writes are not allowed.'});
    if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(415,{error:'Use application/json.'});
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>32768)throw new DeskError('Request too large.',413);}
    let body;try{body=JSON.parse(raw||'{}');}catch{throw new DeskError('Invalid JSON.');}
    if(url.pathname==='/api/sessions')return json(201,desk.createSession());
    if(url.pathname==='/api/turn')return json(200,desk.turn(body));
    return json(404,{error:'Not found.'});
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
   let relative;try{relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);}catch{res.writeHead(400);return res.end('Invalid path');}
   const file=path.resolve(root,'public',relative);
   if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('Not found');}
   const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  }catch(e){if(e instanceof DeskError)return json(e.status,{error:e.message,...(e.state?{state:e.state}:{})});console.error(e);json(500,{error:'The request failed. Reload the conversation to inspect saved state before retrying.'});}
 });
 return {server,desk};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const dbPath=process.env.DB_PATH||path.join(root,'data','studio.sqlite');fs.mkdirSync(path.dirname(dbPath),{recursive:true});
 const {server,desk}=createService({dbPath});const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||3010;
 server.listen(port,host,()=>console.log(`Voice Studio: http://${host}:${port}\nIsolated database: ${dbPath}`));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{desk.close();process.exit(0);}));
}
