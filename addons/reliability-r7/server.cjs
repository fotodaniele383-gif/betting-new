'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const core=require('./core.cjs');
const ROOT=path.resolve(process.env.BETTINGAPP_ROOT||path.join(__dirname,'..','..'));
const PORT=Number(process.env.BETTINGAPP_R7_PORT||3191);
const WEB=path.join(__dirname,'public');
function isLocal(addr){return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(addr);}
function send(res,code,data,type='application/json; charset=utf-8'){
 const body=typeof data==='string'?data:JSON.stringify(data);
 res.writeHead(code,{'Content-Type':type,'Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(body);
}
function editorState(root,id){const edit=require(path.join(root,'addons','calcio-editor','core.js'));
 const games=edit.readMatches(root),m=games.find(x=>x.id===id);
 if(!m)throw Error('R7_MATCH_UNKNOWN');
 const last=edit.latest(root,id);return {match:m,revision:last?.revision||0,analysis:last?edit.estimate(m,last):null,
  comparison:last?edit.compare(m,edit.getJournal(root).filter(x=>x.eventId===id).at(-2)||null,last):null,
  missing:edit.missingEvidence(m,last),calibration:'UNCERTIFIED_UNLESS_INDEPENDENT_EVIDENCE',
  legacyDeepScan:'SEPARATE_WORKER_NOT_AUTOMATICALLY_CERTIFIED'};
}
function createServer(root=ROOT){return http.createServer(async(req,res)=>{
 try{
  if(!isLocal(req.socket.remoteAddress))return send(res,403,{error:'R7_LOOPBACK_ONLY'});
  const host=String(req.headers.host||'');if(!['127.0.0.1:'+PORT,'localhost:'+PORT].includes(host))return send(res,403,{error:'R7_HOST_REJECTED'});
  const u=new URL(req.url,'http://127.0.0.1:'+PORT);
  if(req.method==='GET'&&u.pathname==='/api/health')return send(res,200,{ok:true,version:core.VERSION,dbWrites:false,legacyWrites:false,readOnlyDb:true});
  if(req.method==='GET'&&u.pathname==='/api/cases')return send(res,200,core.report(root));
  if(req.method==='GET'&&u.pathname==='/api/edited-match'){
   if(!/^[a-f0-9]{24}$/.test(u.searchParams.get('id')||''))return send(res,400,{error:'R7_ID_INVALID'});
   return send(res,200,editorState(root,u.searchParams.get('id')));
  }
  if(req.method==='POST'&&u.pathname==='/api/evidence'){
   if(!['http://127.0.0.1:'+PORT,'http://localhost:'+PORT].includes(String(req.headers.origin||'')))return send(res,403,{error:'R7_ORIGIN_REJECTED'});
   if(!/^application\/json(?:;|$)/i.test(String(req.headers['content-type']||'')))return send(res,415,{error:'R7_JSON_ONLY'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>8192)return send(res,413,{error:'R7_BODY_TOO_LARGE'});}
   const b=JSON.parse(raw);if(!/^(CALCIO_SETTLEMENT|TENNIS_SCHEDULE|TENNIS_FORWARD):\d{1,10}$/.test(String(b.key||'')))return send(res,400,{error:'R7_CASE_KEY_INVALID'});
   const c=core.snapshot(root).cases.find(x=>x.key===b.key);if(!c)return send(res,404,{error:'R7_CASE_NOT_FOUND_OR_NO_LONGER_ELIGIBLE'});
   const entry=core.appendEvidence(root,c,b.evidence,b.expectedRevision);return send(res,201,{success:true,entry,legacyDbModified:false,status:'PENDING_INDEPENDENT_VERIFICATION'});
  }
  const files={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
  if(req.method==='GET'&&files[u.pathname]){const [file,mime]=files[u.pathname];return send(res,200,fs.readFileSync(path.join(WEB,file),'utf8'),mime);}
  return send(res,404,{error:'R7_NOT_FOUND'});
 }catch(e){const msg=String(e.message||e);const code=/R7_(?:REVISION|EVIDENCE_|HTTPS|TIMESTAMP|SOURCE_|SCORE_|FORWARD_|SCHEDULE_|NOTES_|ID_|CASE_|JOURNAL_|MATCH_)/.test(msg)?400:500;
  console.error('R7_REQUEST_ERROR='+msg);return send(res,code,{error:msg.slice(0,230)});}
});}
if(require.main===module){try{
 const r=core.snapshot(ROOT);console.log('R7_PRESTART_DB=OK CASES='+r.cases.length);
 const server=createServer();server.on('error',e=>{console.error('R7_SERVER_ERROR='+e.message);process.exitCode=1;});
 server.listen(PORT,'127.0.0.1',()=>{
  console.log('R7_RECONCILIATION_READY=http://127.0.0.1:'+PORT+' DB_READ_ONLY=TRUE');
  if(process.platform==='win32' && process.env.BETTINGAPP_R7_OPEN_BROWSER==='1'){
   try{const cp=require('node:child_process');const child=cp.spawn('cmd.exe',['/d','/c','start','',`http://127.0.0.1:${PORT}/`],{detached:true,stdio:'ignore',windowsHide:true});child.unref();}
   catch(e){console.error('R7_BROWSER_OPEN_FAILED='+String(e.message||e));}
  }
 });
}catch(e){console.error('R7_START_FAIL='+e.message);process.exitCode=1;}}
module.exports={createServer,editorState};
