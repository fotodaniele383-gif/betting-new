'use strict';
// UI integration: local, same-origin, non-monetary, no SQLite writes.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const core=require('./core');
const ROOT=path.resolve(__dirname,'..','..');
const SITE=path.join(__dirname,'public');
const ROUTER_VERSION='BETTINGAPP_CALCIO_EDITOR_R4_MATCH_BOOTSTRAP_20261109';
function matches(root,sport='CALCIO'){return core.readMatches(root,sport);}
function safeHtml(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalized(x){return String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function matchForQuery(list,{rowId,match}){
 if(rowId){const n=Number(rowId);if(Number.isSafeInteger(n)&&n>0){const found=list.find(m=>m.rows.some(r=>Number(r.id)===n));if(found)return found;}}
 const q=normalized(match);if(!q)return null;
 const byExact=list.find(m=>normalized(m.home+' - '+m.away)===q);if(byExact)return byExact;
 const ordered=list.filter(m=>q.includes(normalized(m.home))&&q.includes(normalized(m.away)));
 return ordered.length===1?ordered[0]:null;
}
function findMatch(root,id){if(!/^[a-f0-9]{24}$/.test(String(id||'')))throw Error('MATCH_ID_INVALIDO');const m=matches(root).find(x=>x.id===id);if(!m)throw Error('MATCH_NON_TROVATO');return m;}
function worker(root,match,revision){return new Promise(resolve=>{
  let finished=false,stdout='',stderr='';
  const child=cp.spawn(process.execPath,[path.join(__dirname,'deepscan-worker.cjs')],{
    cwd:root,env:{...process.env,BETTINGAPP_ROOT:root},stdio:['pipe','pipe','pipe'],windowsHide:true
  });
  const finish=x=>{if(finished)return;finished=true;clearTimeout(timer);resolve(x);};
  const timer=setTimeout(()=>{child.kill();finish({success:false,error:'DEEPSCAN_TIMEOUT_20S',status:'FAILED'});},20000);
  child.on('error',e=>finish({success:false,error:'DEEPSCAN_SPAWN_ERROR:'+e.code,status:'FAILED'}));
  child.stdout.on('data',d=>{stdout+=d;if(stdout.length>130000){child.kill();finish({success:false,error:'DEEPSCAN_OUTPUT_TOO_LARGE',status:'FAILED'});}});
  child.stderr.on('data',d=>{stderr+=d;if(stderr.length>4000)stderr=stderr.slice(-4000);});
  child.on('close',()=>{try{finish(JSON.parse(stdout));}catch(_){finish({success:false,error:'DEEPSCAN_WORKER_NO_JSON '+stderr.slice(0,120),status:'FAILED'});}});
  child.stdin.on('error',()=>{});
  child.stdin.end(JSON.stringify({root,match,revision}));
});}
function isLocalSameOrigin(req,requireOrigin){
 const host=String(req.headers.host||'').toLowerCase();
 const origin=String(req.headers.origin||'').toLowerCase();
 const port=String(process.env.PORT||3188);
 const hosts=['127.0.0.1:'+port,'localhost:'+port];
 const remote=String(req.socket?.remoteAddress||'');
 const site=String(req.headers['sec-fetch-site']||'').toLowerCase();
 return hosts.includes(host) && ['127.0.0.1','::ffff:127.0.0.1','::1'].includes(remote)
   && (!site||['same-origin','none'].includes(site))
   && (!requireOrigin || ['http://'+hosts[0],'http://'+hosts[1]].includes(origin))
   && (!origin||['http://'+hosts[0],'http://'+hosts[1]].includes(origin));
}
function createRouter(express,{root=ROOT}={}){
 const router=express.Router();
 const inFlight=new Map(),latestJob=new Map();
 let cached={CALCIO:{expires:0,data:[]},TENNIS:{expires:0,data:[]}};
 const available=(sport='CALCIO')=>{const k=sport==='TENNIS'?'TENNIS':'CALCIO';const now=Date.now();if(cached[k].expires>now)return cached[k].data;const data=matches(root,k);cached[k]={expires:now+10000,data};return data;};
 const find=id=>{if(!/^[a-f0-9]{24}$/.test(String(id||'')))throw Error('MATCH_ID_INVALIDO');const m=available('CALCIO').find(x=>x.id===id);if(!m)throw Error('MATCH_NON_TROVATO');return m;};
 const fail=(res,e)=>{const s=String(e.message||e);res.status(/(?:INVALID|NON_VALID|MISMATCH|INCOMPLET|QUOTA_|EVIDENZA_|DISTRIBUZIONE_|REVISION_CONFLICT|NESSUNA_QUOTA|MATCH_|URL_|POST_MATCH|POST_KICKOFF|KICKOFF_|TROPPE_|RICHIEST)/.test(s)?400:500).json({success:false,error:s.slice(0,240)});};
 const schedule=(match,revision)=>{
  const key=match.id;
  const old=inFlight.get(key);
  if(old && old.revision===revision.revision)return old;
  const job={eventId:key,revision:revision.revision,status:'RUNNING',startedAt:new Date().toISOString(),result:null};
  latestJob.set(key,job);
  const promise=worker(root,match,revision).then(result=>{
    job.status=result.success===true?'COMPLETE':'FAILED';job.result=result;job.finishedAt=new Date().toISOString();
  }).catch(e=>{job.status='FAILED';job.result={success:false,error:String(e.message||e)};job.finishedAt=new Date().toISOString()}).finally(()=>{
    if(inFlight.get(key)===job)inFlight.delete(key);
  });
  job.promise=promise;inFlight.set(key,job);return job;
 };
 router.use((req,res,next)=>{
  if(!isLocalSameOrigin(req,['POST','PUT','PATCH','DELETE'].includes(req.method)))return res.status(403).json({error:'ACCESSO_SOLO_LOOPBACK_STESSA_ORIGINE'});
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'no-referrer',
   'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"});
  next();
 });
 router.get('/api/health',(_req,res)=>res.json({success:true,version:ROUTER_VERSION,dbWrites:false,manualOnly:true}));
 router.get('/api/resolve',(req,res)=>{try{const m=matchForQuery(available('CALCIO'),req.query||{});if(!m)return res.status(404).json({error:'MATCH_NON_TROVATO_NEL_DATABASE',count:available('CALCIO').length});res.json({match:m,missing:core.missingEvidence(m,core.latest(root,m.id))});}catch(e){fail(res,e);}});
 router.get('/api/fields',(_req,res)=>res.json({fields:core.CHECKLIST}));
 router.get('/api/matches',(req,res)=>{try{res.json({matches:available(req.query.sport==='TENNIS'?'TENNIS':'CALCIO')});}catch(e){fail(res,e);}});
 router.get('/api/state',(req,res)=>{try{const m=find(req.query.id),r=core.latest(root,m.id),j=core.getJournal(root).filter(x=>x.eventId===m.id),prev=j.length>1?j[j.length-2]:null;
   res.json({match:m,revision:r,analysis:core.estimate(m,r),comparison:r?core.compare(m,prev,r):null,deepScan:latestJob.get(m.id)||null,missing:core.missingEvidence(m,r)});}catch(e){fail(res,e);}});
 router.post('/api/save',(req,res)=>{try{
  const b=req.body||{};const m=find(b.eventId),prev=core.latest(root,m.id),r=core.saveRevision(root,m,b);
  const analysis=core.estimate(m,r),comparison=core.compare(m,prev,r);
  const job=(Object.keys(r.evidence||{}).length>0)?schedule(m,r):null;
  res.json({revision:r,analysis,comparison,missing:core.missingEvidence(m,r),deepScan:job?{status:job.status,revision:r.revision}:null,source:'REVISION_APPEND_ONLY'});
 }catch(e){fail(res,e);}});
 router.post('/api/deepscan',(req,res)=>{try{const m=find(req.body?.eventId),r=core.latest(root,m.id);if(!r)return res.status(409).json({error:'SALVA_PRIMA_I_DATI'});
   const job=schedule(m,r);res.json({revision:r.revision,deepScan:{status:job.status,revision:job.revision}});
 }catch(e){fail(res,e);}});
 router.get('/api/deepscan-status',(req,res)=>{try{const m=find(req.query.id),job=latestJob.get(m.id);res.json({deepScan:job?{status:job.status,revision:job.revision,result:job.result,startedAt:job.startedAt,finishedAt:job.finishedAt}:null});}catch(e){fail(res,e);}});
 router.get('/prompts/:sport',(req,res)=>{const fn=req.params.sport==='calcio'?'CALCIO_H_V2.md':req.params.sport==='tennis'?'TENNIS_H_V2.md':null;
   if(!fn)return res.sendStatus(404);res.type('text/plain; charset=utf-8').send(fs.readFileSync(path.join(__dirname,'prompts',fn),'utf8'));
 });
 // Render the match choices on the SERVER too. The select never stays on 'Caricamento match...' when JS or API fails.
 router.get('/',(_req,res)=>{try{
  const items=available('CALCIO');const opts=items.map(m=>`<option value="${safeHtml(m.id)}">${safeHtml(m.home+' – '+m.away+' · '+(m.league||'')+' · '+m.kickoff)}</option>`).join('');
  let html=fs.readFileSync(path.join(SITE,'index.html'),'utf8');html=html.replace('<!--SERVER_MATCH_OPTIONS-->',opts);
  res.type('html').send(html);
 }catch(e){fail(res,e);}});
 for(const [route,name,mime] of [['/app.js','app.js','javascript'],['/style.css','style.css','css']])router.get(route,(_req,res)=>res.type(mime).send(fs.readFileSync(path.join(SITE,name))));
 return router;
}
module.exports={createRouter,ROUTER_VERSION,isLocalSameOrigin,worker};
