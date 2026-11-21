import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import worker from '../worker/index.mjs';
import { database } from './local-db.mjs';
const port = Number(process.env.PORT || 8787), origin=`http://127.0.0.1:${port}`;
const root=resolve('request');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const env={DB:database(),LOCAL_DEV:'1',PUBLIC_ORIGIN:origin,SESSION_SECRET:crypto.randomUUID()+crypto.randomUUID(),ASSETS:{async fetch(req){
  const path=decodeURIComponent(new URL(req.url).pathname), file=resolve(root,`.${path.endsWith('/')?`${path}index.html`:path}`);
  if(!file.startsWith(root+'\\')&&!file.startsWith(root+'/'))return new Response('Not found',{status:404});
  try{return new Response(await readFile(file),{headers:{'Content-Type':types[extname(file)]||'application/octet-stream'}});}catch{return new Response('Not found',{status:404});}
}}};
http.createServer(async(req,res)=>{
  try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const data=Buffer.concat(chunks);const request=new Request(origin+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:data});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Local server error');}
}).listen(port,'127.0.0.1',()=>console.log(`Local preview: ${origin}/ | Admin: ${origin}/admin/ (synthetic data, memory only; production login bypass is NOT enabled)`));
