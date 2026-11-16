'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const core=require('./core');const root=path.resolve(process.env.BETTINGAPP_ROOT||path.resolve(__dirname,'..','..'));
const port=3190,host='127.0.0.1';const site=path.join(__dirname,'public');
function send(res,status,payload,mime='application/json; charset=utf-8'){
 res.writeHead(status,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'"});res.end(typeof payload==='string'||Buffer.isBuffer(payload)?payload:JSON.stringify(payload));}
function sameOrigin(req){const hostHeader=String(req.headers.host||'').toLowerCase(),o=String(req.headers.origin||'');const allowed=['127.0.0.1:'+port,'localhost:'+port];
 const a=req.socket.remoteAddress;return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(a)&&allowed.includes(hostHeader)&&(!o||['http://127.0.0.1:'+port,'http://localhost:'+port].includes(o));}
async function body(req){let txt='';for await(const chunk of req){txt+=chunk;if(txt.length>150000)throw Error('PAYLOAD_TROPPO_GRANDE');}return JSON.parse(txt||'{}');}
const matchCache=(sport)=>core.readMatches(root,sport);
function findMatch(id){if(!/^[a-f0-9]{24}$/.test(id||''))throw Error('MATCH_ID_INVALIDO');const x=matchCache('CALCIO').find(m=>m.id===id);if(!x)throw Error('MATCH_NON_TROVATO');return x;}
function worker(match,revision){return new Promise((resolve,reject)=>{
 const c=cp.spawn(process.execPath,[path.join(__dirname,'deepscan-worker.cjs')],{cwd:root,env:{...process.env,BETTINGAPP_ROOT:root},stdio:['pipe','pipe','pipe'],windowsHide:true});
 let stdout='',stderr='';const killer=setTimeout(()=>c.kill(),20000);c.stdout.on('data',d=>{stdout+=d;if(stdout.length>120000)c.kill()});c.stderr.on('data',d=>{stderr+=d;if(stderr.length>3000)stderr=stderr.slice(-3000)});
 c.on('error',e=>{clearTimeout(killer);reject(e)});
 c.on('close',()=>{clearTimeout(killer);try{const x=JSON.parse(stdout);resolve(x)}catch{resolve({success:false,error:'DEEPSCAN_PROCESS_UNAVAILABLE '+stderr.slice(0,250)})}});
 c.stdin.end(JSON.stringify({root,match,revision}));});}
const server=http.createServer(async(req,res)=>{
 try{
 if(!sameOrigin(req))return send(res,403,{error:'ACCESSO_SOLO_LOOPBACK_STESSA_ORIGINE'});
 const u=new URL(req.url,'http://127.0.0.1:'+port);
 if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,mode:'CALCIO_EDITOR_ADDON',dbWrites:false});
 if(req.method==='GET'&&u.pathname==='/api/matches')return send(res,200,{matches:matchCache(u.searchParams.get('sport')==='TENNIS'?'TENNIS':'CALCIO')});
 if(req.method==='GET'&&u.pathname==='/api/state'){
  const match=findMatch(u.searchParams.get('id'));const history=core.getJournal(root).filter(x=>x.eventId===match.id);const rev=history.at(-1)||null;return send(res,200,{match,revision:rev,analysis:core.estimate(match,rev),comparison:rev?core.compare(match,history.at(-2)||null,rev):null});}
 if(req.method==='POST'&&u.pathname==='/api/save'){
  const b=await body(req);const match=findMatch(b.eventId);const previous=core.latest(root,match.id);const revision=core.saveRevision(root,match,b);return send(res,200,{revision,analysis:core.estimate(match,revision),comparison:core.compare(match,previous,revision)});}
 if(req.method==='POST'&&u.pathname==='/api/deepscan'){
  const b=await body(req),match=findMatch(b.eventId),revision=core.latest(root,match.id);
  if(!revision)return send(res,409,{error:'SALVA_PRIMA_I_DATI'});
  const result=await worker({...match,kickoff:revision.match.kickoff},revision);return send(res,200,{revision:revision.revision,deepScan:result});}
 if(req.method==='GET'&&u.pathname.startsWith('/prompts/')){
  const which=u.pathname==='/prompts/calcio'?'CALCIO_H_V2.md':u.pathname==='/prompts/tennis'?'TENNIS_H_V2.md':null;
  if(!which)return send(res,404,{error:'NOT_FOUND'});
  return send(res,200,fs.readFileSync(path.join(__dirname,'prompts',which),'utf8'),'text/plain; charset=utf-8');}
 if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/app.js'||u.pathname==='/style.css')){
  const fn=u.pathname==='/'?'index.html':u.pathname.slice(1);const map={'index.html':'text/html','app.js':'application/javascript','style.css':'text/css'};
  return send(res,200,fs.readFileSync(path.join(site,fn)),map[fn]+'; charset=utf-8');}
 send(res,404,{error:'NOT_FOUND'});
 }catch(err){send(res,/INVALID|NON_VALID|MISMATCH|INCOMPLET|QUOTA_|EVIDENZA_|DISTRIBUZIONE_|REVISION_CONFLICT|NESSUNA_QUOTA|MATCH_|URL_|POST_MATCH|POST_KICKOFF/.test(String(err.message))?400:500,{error:String(err.message||err).slice(0,200)});}
});
if(require.main===module){server.listen(port,host,()=>{console.log('EDITOR_CALCIO_PRONTO=http://127.0.0.1:'+port+' ROOT='+root);
 if(process.platform==='win32'&&process.env.EDITOR_NO_BROWSER!=='1'){try{const open=cp.spawn('cmd.exe',['/d','/c','start','','http://127.0.0.1:'+port],{detached:true,stdio:'ignore',windowsHide:true});open.unref();}catch(e){console.warn('BROWSER_MANUALE=http://127.0.0.1:'+port)}}
 });server.on('error',e=>{console.error('EDITOR_AVVIO_ERRORE='+e.message);process.exitCode=1});}
module.exports={server};
