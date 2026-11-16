#!/usr/bin/env node
'use strict';
const path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const ledger=require(path.join(root,'backend','tennisClvDegradedLedgerPatch47.js'));
const checks=[];function check(name,ok,details=null){checks.push({name,ok:Boolean(ok),details});}
const now=new Date('2026-08-05T07:20:00.000Z');
const base={id:47001,sport_type:'TENNIS',bet_type:'TENNIS_ATP_MONEYLINE',match_date:'05/08/2026, 12:00:00',odd:2,prediction:'1',clv_source_event_id:'EV47',clv_event_fingerprint:'EFP47',clv_market_fingerprint:'MFP47',closing_odd_side:'1'};
const keyA=ledger.buildEvidenceKey(base,{opening_odd:2,closing_odd:1.8,clv_source:'LIVE_API',clv_opening_ts:'2026-08-05T06:00:00Z',clv_closing_ts:'2026-08-05T07:00:00Z',clv_bookmaker:'Pinnacle|Betfair',clv_contract_status:'VERIFIED',clv_contract_reason:'CONTRACT_OK'});
const keyB=ledger.buildEvidenceKey(base,{opening_odd:2,closing_odd:1.8,clv_source:'live_api',clv_opening_ts:'2026-08-05T06:00:00Z',clv_closing_ts:'2026-08-05T07:00:00Z',clv_bookmaker:'Betfair|Pinnacle',clv_contract_status:'verified',clv_contract_reason:'contract_ok'});
check('Versione ledger Patch47',ledger.TENNIS_CLV_DEGRADED_LEDGER_VERSION==='TENNIS_CLV_DEGRADED_LEDGER_V1_PATCH47');
check('Otto stati minimi presenti',Object.keys(ledger.STATES).length===8,ledger.STATES);
check('Chiave evidenza deterministica e bookmaker order-independent',keyA===keyB,{keyA,keyB});
check('Chiave cambia se closing odd cambia',keyA!==ledger.buildEvidenceKey(base,{opening_odd:2,closing_odd:1.81,clv_source:'LIVE_API',clv_opening_ts:'2026-08-05T06:00:00Z',clv_closing_ts:'2026-08-05T07:00:00Z',clv_bookmaker:'Betfair|Pinnacle',clv_contract_status:'VERIFIED',clv_contract_reason:'CONTRACT_OK'}));
const verified=ledger.classifyClvState(base,{closing_odd:1.8,clv_verified:1,clv_contract_status:'VERIFIED'},now);
check('Verified terminale',verified.state==='VERIFIED'&&verified.terminal&&verified.retryEligible===0,verified);
const temporal=ledger.classifyClvState({...base,match_date:'04/08/2026, 12:00:00'},{closing_odd:6.8,clv_verified:0,clv_source:'POST_MATCH_VAULT',clv_contract_status:'AVAILABLE_UNVERIFIED',clv_contract_reason:'CLOSING_AFTER_MATCH_START'},now);
check('Conflitto temporale post-match terminale',temporal.state==='IRRECOVERABLE_TEMPORAL'&&temporal.terminal,temporal);
const market=ledger.classifyClvState({...base,match_date:'20/07/2026, 12:00:00'},{clv:0,clv_pending_reason:'CLV_VAULT_NO_SNAPSHOT'},now);
check('Assenza mercato fuori recovery terminale',market.state==='IRRECOVERABLE_MARKET'&&market.terminal,market);
const retry=ledger.classifyClvState(base,{clv:0,clv_pending_reason:'CLV_VAULT_NO_SNAPSHOT'},now);
check('Match futuro senza evidenza retry eligible',retry.state==='RETRY_ELIGIBLE'&&retry.retryEligible===1&&!retry.terminal,retry);
const exhausted=ledger.classifyClvState(base,{clv:0,clv_last_attempt_result:'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED'},now);
check('Max tentativi terminale',exhausted.state==='MAX_ATTEMPTS_EXHAUSTED'&&exhausted.terminal,exhausted);
const semantic=ledger.buildSemanticFields(base,{closing_odd:1.8,clv_verified:1,clv_contract_status:'VERIFIED'},now);
const same=ledger.buildSemanticFields({...base,...semantic.fields},{closing_odd:1.8,clv_verified:1,clv_contract_status:'VERIFIED'},now);
check('Seconda evidenza identica riconosciuta unchanged',same.unchanged===true&&same.evidenceKey===semantic.evidenceKey,same);
check('TPI/Stake non fanno parte della chiave CLV',ledger.buildEvidenceKey({...base,stake:2},{closing_odd:1.8})===ledger.buildEvidenceKey({...base,stake:100},{closing_odd:1.8}));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES',suite:'PATCH47_LEDGER_CONTRACT',checks:checks.length,details:checks,failures:failed},null,2));if(failed.length)process.exit(1);
