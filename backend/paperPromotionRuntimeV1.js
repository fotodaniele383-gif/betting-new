'use strict';
/** Optional sidecar; reads ai_forward_test, writes ONLY its own JSON/JSONL files. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const P=require('./paperPromotionPolicyV1');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const REQUIRED=['id','sport_type','data_quality','paper_result_active','paper_result_conflict','bet_type','match_start_at','match_date','home_team','away_team','league','market_type','strategy_tag','model_version','prediction','odd','estimated_prob','stake','status','settlement_contract_status','settlement_source','settlement_contract_source','result_source','settlement_evidence_hash','settlement_source_event_id','clv_verified','clv_pct',
'canonical_event_time_canonical_utc','canonical_event_time_safety_utc',
'canonical_event_time_quality_status','prematch_capture_gate_status',
'official_schedule_receipt_id','official_schedule_status',
'official_schedule_source_kind','official_schedule_capture_disposition',
'opening_odd','closing_odd','clv_opening_ts','clv_closing_ts',
'clv_bookmaker','clv_source','clv_source_event_id',
'clv_event_fingerprint','clv_market_fingerprint','clv_contract_status',
'clv_contract_version','clv_point_line','point_line','closing_odd_side',
'tennis_event_fingerprint','tennis_market_fingerprint',
'canonical_match_datetime','clv_sport_key_resolved',
'clv_cross_sport_sport_key'];
function readRows(db){const cols=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));const must=['id','sport_type','match_date','status','stake','odd','estimated_prob','league','strategy_tag','model_version','prediction','home_team','away_team','settlement_contract_status','settlement_evidence_hash','settlement_source_event_id'];for(const c of must)if(!cols.has(c))throw Error('MISSING_REQUIRED_COLUMN_'+c);const projected=REQUIRED.filter(c=>cols.has(c));return db.prepare(`SELECT ${projected.map(c=>'"'+c+'"').join(',')} FROM ai_forward_test WHERE UPPER(sport_type) IN ('CALCIO','TENNIS') AND COALESCE(paper_result_active,1)=1`).all();}
function integrity(v){return sha({version:v.version,anchors:v.anchors,groups:v.groups,transitions:v.transitions,journalHead:v.journalHead||null});}
function load(directory){const file=path.join(directory,'policy-state.json'),log=path.join(directory,'policy-transitions.jsonl');if(!fs.existsSync(file)){if(fs.existsSync(log))throw Error('ORPHAN_JOURNAL_FAIL_CLOSED');const v=P.empty();v.journalHead=null;v.integrity=integrity(v);return v;}
 const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.integrity!==integrity(v))throw Error('STATE_INTEGRITY_MISMATCH');if(v.version!==P.VERSION)throw Error('STATE_VERSION_MISMATCH');const journal=fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split(/\r?\n/).filter(Boolean):[];let prev=null;for(const raw of journal){const entry=JSON.parse(raw);if(entry.prev!==prev||sha({prev:entry.prev,change:entry.change})!==entry.hash)throw Error('JOURNAL_CHAIN_INVALID');prev=entry.hash;}if(prev!==(v.journalHead||null))throw Error('JOURNAL_HEAD_MISMATCH');return v;}
function save(directory,prior,next){fs.mkdirSync(directory,{recursive:true});const log=path.join(directory,'policy-transitions.jsonl'),file=path.join(directory,'policy-state.json');if(next.transitions.length<prior.transitions.length)throw Error('TRANSITIONS_ROLLBACK_FORBIDDEN');const transitions=next.transitions.slice(prior.transitions.length);let head=prior.journalHead||null;const records=[];for(const change of transitions){const entry={prev:head,change,hash:sha({prev:head,change})};records.push(JSON.stringify(entry));head=entry.hash;}
 if(records.length)fs.appendFileSync(log,records.join('\n')+'\n',{flag:'a'});
 next.journalHead=head;next.integrity=integrity(next);const temp=file+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify(next),{flag:'wx'});fs.renameSync(temp,file);return next;}
function install(app,db,{directory=path.join(__dirname,'paper-promotion-runtime'),intervalMs=60000,enabled=process.env.PAPER_PROMOTION_MONITOR==='1'}={}){
 let last=null,error=null,timer=null,first=null;function tick(){if(!enabled)return {enabled:false};try{const prev=load(directory);const next=P.run(readRows(db),prev);last=save(directory,prev,next);error=null;return {success:true,groups:Object.keys(last.groups).length};}catch(e){error=e.message;last=null;console.error('[PAPER_PROMOTION_V1] FAIL_CLOSED:',error);return {success:false,error};}}
 app.get('/api/paper-promotion/status',(req,res)=>{res.set('Cache-Control','no-store');if(!enabled)return res.json({success:true,enabled:false,executionIntegrated:false,paperOnly:true,policyVersion:P.VERSION});if(error||!last)return res.status(503).json({success:false,enabled:true,executionIntegrated:false,error:error||'BOOTSTRAPPING_FAIL_CLOSED'});let sport=String(req.query.sport||'').toUpperCase();if(sport&&!['TENNIS','CALCIO'].includes(sport))return res.status(400).json({success:false,error:'INVALID_SPORT'});const groups=Object.fromEntries(Object.entries(last.groups).filter(([,g])=>!sport||g.identity.sport===sport));return res.json({success:true,enabled:true,executionIntegrated:false,paperOnly:true,policyVersion:P.VERSION,updatedAt:last.updatedAt,counts:{anchors:last.anchorCount,groups:Object.keys(groups).length,transitions:last.transitions.length},groups,exclusions:last.exclusions});});
 if(enabled){first=setTimeout(tick,3000);first.unref?.();timer=setInterval(tick,Math.max(60000,intervalMs));timer.unref?.();}
 return {tick,stop(){if(first)clearTimeout(first);if(timer)clearInterval(timer);},decideFutureStake:(signal,authority,opts)=>{if(error||!last||!enabled)return {stake:0,scope:'STUDIO',reason:'RUNTIME_NOT_READY'};return P.decideFutureStake(last,signal,authority,opts);}};
}
module.exports={install,load,save,readRows,integrity};
