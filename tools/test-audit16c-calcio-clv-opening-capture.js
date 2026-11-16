#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(process.argv[process.argv.indexOf('--root')+1]||path.join(__dirname,'..'));
const mod=require(path.join(ROOT,'backend','calcioClvOpeningCaptureAudit16c.js'));
const checks=[];const add=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
try{
 const bet={prediction:'O2.5',market_type:'TOTALS',odd:1.95,league:'Serie A',home:'Roma',away:'Milan',match_date:'2026-10-10T18:45:00.000Z',event_key:'SERIEA|ROMA|MILAN|2026-10-10',provider_event_id:'odds-123',point_line:2.5,oddsCertification:{selectedSource:{providerEventId:'odds-123',bookmakerKey:'pinnacle',bookmakerTitle:'Pinnacle',lastUpdate:'2026-09-25T07:00:00.000Z'}}};
 const f=mod.buildOpeningEvidenceFields(bet,{sportKey:'soccer_italy_serie_a',now:'2026-09-25T07:05:00.000Z'});
 add('Version',mod.VERSION==='AUDIT16C_CALCIO_CLV_OPENING_CAPTURE_V1');
 add('Opening odd captured',f.opening_odd===1.95);
 add('Bookmaker and source event captured',f.clv_bookmaker==='Pinnacle'&&f.clv_source_event_id==='odds-123');
 add('Sport key captured at opening',f.clv_sport_key_resolved==='soccer_italy_serie_a'&&f.clv_sport_key_discovery_status==='RESOLVED_AT_OPENING_CAPTURE');
 add('Fingerprints complete',/^[a-f0-9]{64}$/.test(f.clv_event_fingerprint)&&/^[a-f0-9]{64}$/.test(f.clv_market_fingerprint));
 add('Opening remains pending not falsely verified',f.clv_contract_status==='PENDING'&&f.clv_verified===0&&f.closing_line_available===0);
 add('No closing/source claim at opening',!Object.prototype.hasOwnProperty.call(f,'closing_odd')&&!Object.prototype.hasOwnProperty.call(f,'clv_source'));
 const existing={prediction:'O2.5',opening_odd:2.02,clv_opening_ts:1760000000000,clv_bookmaker:'OriginalBook',clv_source_event_id:'old-id',clv_market_fingerprint:f.clv_market_fingerprint,clv_sport_key_resolved:'soccer_italy_serie_a'};
 const preserved=mod.buildOpeningEvidenceFields({...bet,odd:1.88},{existing,sportKey:'soccer_italy_serie_a',now:'2026-09-25T08:00:00.000Z'});
 add('Same market preserves first opening anchor',preserved.opening_odd===2.02&&preserved.clv_opening_ts===1760000000000&&preserved.clv_bookmaker==='OriginalBook');
 const changed=mod.buildOpeningEvidenceFields({...bet,prediction:'1',market_type:'1X2',odd:2.3,point_line:null},{existing,sportKey:'soccer_italy_serie_a',now:'2026-09-25T08:00:00.000Z'});
 add('Market change creates new opening anchor',changed.opening_odd===2.3&&changed.clv_market_fingerprint!==f.clv_market_fingerprint&&changed.clv_bookmaker==='Pinnacle');
 const partial=mod.buildOpeningEvidenceFields({...bet,oddsCertification:{selectedSource:{providerEventId:'odds-123',lastUpdate:'2026-09-25T07:00:00.000Z'}}},{sportKey:'soccer_italy_serie_a'});
 add('Missing bookmaker stays partial/fail-closed',String(partial.clv_contract_reason).includes('MISSING_BOOKMAKER')&&partial.clv_verified===0);
 const server=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8');
 add('Analysis caches existing odds into CLV vault',server.includes('cacheOddsDataToVault(db, config.api, rawLiveMatches)'));
 add('CLV columns ensured before Calcio persistence',server.includes('ensureClvColumns(db);'));
 add('Candidate binds resolved sport key',server.includes('clv_sport_key_resolved: config.api'));
 add('Initial persistence stores opening evidence',server.includes('buildOpeningEvidenceFields(bet, { sportKey: bet.clv_sport_key_resolved })'));
 add('Finalization rebinds opening evidence to final market',server.includes('Object.assign(gateFields, calcioClvOpeningCaptureAudit16c.buildOpeningEvidenceFields'));
}catch(e){add('Unhandled test exception',false,{message:e.message,stack:e.stack});}
const failures=checks.filter(x=>!x.ok);const out={success:failures.length===0,patch:'AUDIT16C',checks:checks.length,failures,details:checks};console.log(JSON.stringify(out,null,2));process.exit(out.success?0:1);
