'use strict';
// Prospective study assessment only. Never grants a stake or edits a bet.
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const A=require('./public/portfolioAccounting');
const POLICY=Object.freeze({version:'R3_FORWARD_V1',minimum:100,half:50,spanDays:28,clvCoverage:0.8});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function utc(v){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(v))return null;const m=v.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(d.getUTCFullYear()!==+m[1]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[3]||+m[4]>23||+m[5]>59||+(m[6]||0)>59)return null;const t=Date.parse(v);return Number.isFinite(t)?t:null;}
const single=r=>!String(r.bet_type||'').includes('MULTI');
function anchor(r){return {id:r.id,sport:r.sport_type,scope:A.num(r.stake)===0?'STUDIO':'TRADING',strategy:r.strategy_tag||'',league:r.league||'',market:r.market_type||r.strategy_tag||'',model:r.model_version||'',home:r.home_team||'',away:r.away_team||'',selection:String(r.prediction||''),start:r.match_start_at||r.match_date,prob:A.num(r.estimated_prob),odd:A.num(r.odd),stake:A.num(r.stake)};}
const key=a=>JSON.stringify([a.sport,a.scope,a.strategy,a.league,a.market,a.model]);
const event=a=>JSON.stringify([a.sport,a.start.slice(0,10),[a.home.trim().toLowerCase(),a.away.trim().toLowerCase()].sort()]);
function fresh(){return {version:POLICY.version,anchors:{},groups:{},transitions:[]};}
function stat(x){const n=x.length;if(!n)return null;const mean=x.reduce((s,v)=>s+v,0)/n;const variance=n>1?x.reduce((s,v)=>s+(v-mean)**2,0)/(n-1):Infinity;return {mean,lower:mean-1.96*Math.sqrt(variance/n)};}
function qualifies(xs){if(xs.length<POLICY.half)return false;const p=stat(xs.map(x=>x.unitReturn));const clv=xs.map(x=>x.clv).filter(x=>x!==null);return p.lower>0&&clv.length/xs.length>=POLICY.clvCoverage&&stat(clv).mean>0&&xs.reduce((s,x)=>s+x.brier-x.marketBrier,0)/xs.length<0;}
function advance(rows,input,now=Date.now()){
 if(input.version!==POLICY.version)throw Error('STUDY_STATE_VERSION');
 const state=JSON.parse(JSON.stringify(input));const groups=new Map();
 for(const r of rows){if(!['CALCIO','TENNIS'].includes(r.sport_type)||!A.active(r,r.sport_type)||!single(r)||A.num(r.stake)===null||A.num(r.stake)<0)continue;
 const a=anchor(r),k=key(a);if(!groups.has(k))groups.set(k,{sport:a.sport,scope:a.scope,strategy:a.strategy,league:a.league,model:a.model,historicalResolved:0,eligible:[],excluded:0});const g=groups.get(k);
 if(['WON','LOST'].includes(r.status))g.historicalResolved++;
 if(!state.anchors[r.id]&&r.status==='PENDING'&&utc(a.start)>now&&a.home&&a.away&&a.strategy&&a.selection&&a.model&&a.prob>0&&a.prob<100&&a.odd>1){const payload={...a,capturedAt:new Date(now).toISOString()};state.anchors[r.id]={payload,hash:hash(payload)};}
 const seal=state.anchors[r.id];if(!['WON','LOST'].includes(r.status))continue;
 if(!seal){g.excluded++;continue;}if(hash(seal.payload)!==seal.hash)throw Error('STUDY_ANCHOR_HASH_INVALID');
 const {capturedAt,...original}=seal.payload;
 const source=String(r.settlement_source||r.settlement_contract_source||r.result_source||'');
 if(hash(original)!==hash(a)||utc(capturedAt)>=utc(a.start)||utc(a.start)>now||r.settlement_contract_status!=='VERIFIED'||!source){g.excluded++;continue;}
 const won=r.status==='WON'?1:0;g.eligible.push({id:r.id,event:event(a),time:utc(a.start),unitReturn:won?a.odd-1:-1,brier:(a.prob/100-won)**2,marketBrier:(1/a.odd-won)**2,clv:A.clv(r)});
 }
 const next={};for(const [k,g] of groups){const counts=new Map();for(const x of g.eligible)counts.set(x.event,(counts.get(x.event)||0)+1);const unique=g.eligible.filter(x=>counts.get(x.event)===1).sort((a,b)=>a.time-b.time||a.id-b.id);const recent=unique.slice(-POLICY.minimum),prior=state.groups[k];const duplicates=g.eligible.length-unique.length;const span=recent.length?(recent.at(-1).time-recent[0].time)/86400000:0;
 let status='STUDIO',reason='Campione forward verificato insufficiente';
 if(recent.length>=POLICY.minimum&&span>=POLICY.spanDays){const ok=qualifies(recent.slice(0,POLICY.half))&&qualifies(recent.slice(POLICY.half));status=ok?'CANDIDATA_TRADING':'STUDIO';reason=ok?'Due finestre forward superano i criteri di studio; servono ancora i gate operativi':'Criteri di rendimento, calibrazione o CLV non superati';}
 if(prior&&['CANDIDATA_TRADING','RETROCESSA_STUDIO'].includes(prior.status)&&status!=='CANDIDATA_TRADING'){status='RETROCESSA_STUDIO';reason='Criteri non piu soddisfatti o evidenze insufficienti: '+reason;}
 const {eligible,...summary}=g;next[k]={...summary,status,reason,forwardEligible:unique.length,duplicateEventsExcluded:duplicates,spanDays:Math.floor(span),metrics:stat(recent.map(x=>x.unitReturn)),updatedAt:new Date(now).toISOString(),productionAuthorized:false};
 if(prior?.status!==status)state.transitions.push({at:new Date(now).toISOString(),key:k,from:prior?.status||null,to:status,reason});
 }
 // Missing groups lose candidacy explicitly; no stale promotion survives a removed sample.
 for(const [k,g] of Object.entries(state.groups))if(!next[k])next[k]={...g,status:'RETROCESSA_STUDIO',reason:'Gruppo non piu presente nel campione attivo',forwardEligible:0,productionAuthorized:false};
 state.groups=next;state.updatedAt=new Date(now).toISOString();return state;
}
function install(app,db,{directory=path.join(__dirname,'audit07s-r3-runtime'),intervalMs=60000}={}){
 const file=path.join(directory,'study-state.json');let last=null,error=null;
 function tick(){try{const prior=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):fresh();const rows=db.prepare("SELECT "+require('./audit07sR4ReadColumns').columns(db)+" FROM ai_forward_test WHERE UPPER(sport_type) IN ('CALCIO','TENNIS')").all();const next=advance(rows,prior);fs.mkdirSync(directory,{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next));fs.renameSync(tmp,file);last=next;error=null;}catch(e){error=e.message;console.error('[AUDIT07S_R3_STUDY]',error);}}
 app.get('/api/trading-scopes/study',(req,res)=>{const sport=String(req.query.sport||'').toUpperCase();if(!['CALCIO','TENNIS'].includes(sport))return res.status(400).json({success:false,error:'Sport non valido'});res.set('Cache-Control','no-store');if(error||!last)return res.status(503).json({success:false,error:error||'Valutazione in avvio',productionAuthorized:false});return res.json({success:true,sport,policy:POLICY,updatedAt:last.updatedAt,groups:Object.values(last.groups).filter(g=>g.sport===sport),productionAuthorized:false});});
 const first=setTimeout(tick,3000);first.unref?.();const timer=setInterval(tick,intervalMs);timer.unref?.();return {tick,stop(){clearTimeout(first);clearInterval(timer);}};
}
module.exports={POLICY,anchor,fresh,advance,install,qualifies,utc};
