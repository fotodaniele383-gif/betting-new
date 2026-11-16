#!/usr/bin/env node
'use strict';
const truth=require('../backend/tennisDecisionTruthPatch38');const checks=[];function check(name,ok,details={}){checks.push({name,ok:Boolean(ok),details});}
const hard=truth.resolveDecisionTruth({stake:0,ds_action:'🟢 VALUE CONFERMATO · MICRO',quality_final_code:'BLOCKED_HARD',quality_final_label:'BLOCCATA HARD',tennis_stake_authority_status:'NO_PROPOSED_STAKE'});check('DeepScan positivo non sovrascrive hard block',hard.finalAction==='NO_BET'&&hard.dominantLabel==='NO BET'&&hard.deepScanAuthority===false,hard);
const paper=truth.resolveDecisionTruth({stake:0,ds_action:'📊 EDGE TECNICO',quality_final_code:'WATCHLIST_MICRO',tennis_stake_authority_status:'PAPER_ONLY_INSUFFICIENT_SAMPLE'});check('small sample paper only',paper.finalAction==='PAPER_ONLY',paper);
const micro=truth.resolveDecisionTruth({stake:2,ds_action:'📊 EDGE TECNICO',quality_final_code:'WATCHLIST_MICRO',tennis_stake_authority_status:'AUTHORIZED_MICRO'});check('stake 2 è micro finale',micro.finalAction==='MICRO_STAKE'&&micro.operationalStake===2,micro);
const summary=truth.summarizeRows([{stake:0,ds_action:'VALUE CONFERMATO',quality_final_code:'BLOCKED_HARD'},{stake:0,ds_action:'EDGE TECNICO',quality_final_code:'WATCHLIST_MICRO',tennis_stake_authority_status:'PAPER_ONLY'}]);check('contraddizione advisory rilevata',summary.contradictions===1,summary);
const failed=checks.filter(c=>!c.ok);console.log(JSON.stringify({success:failed.length===0,checks:checks.length,passed:checks.length-failed.length,failed:failed.length,details:checks},null,2));if(failed.length)process.exit(1);
