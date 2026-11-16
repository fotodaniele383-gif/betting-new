#!/usr/bin/env node
'use strict';
const assert=require('assert');const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..');const pub=fs.readFileSync(path.join(root,'public/app.js'),'utf8');const back=fs.readFileSync(path.join(root,'backend/public/app.js'),'utf8');const index=fs.readFileSync(path.join(root,'public/index.html'),'utf8');let checks=0;function c(n,f){f();checks++;}
c('frontend mirror',()=>assert.equal(pub,back));
c('resolver contract UI',()=>assert(pub.includes('function resolveTennisStakeExecutionContractUi')));
c('TPI solo diagnostico',()=>assert(pub.includes('TPI: SOLO DIAGNOSTICO')));
c('nessuna etichetta TPI ambigua',()=>assert(!pub.includes('TPI diagnostico · ranking sportivo</div>\n        <div style="font-size:.60em;color:#a78bfa;font-weight:900;margin-top:3px;line-height:1.2;">NESSUNA AUTORITÀ STAKE')));
c('stadi stake visibili',()=>['Proposta modello','Quality Gate','Risk Authority','Calibration Guard','Finale:'].forEach(v=>assert(pub.includes(v))));
c('autorità finale Patch46',()=>assert(pub.includes('PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT')));
c('advisory usa contract finale',()=>assert(pub.includes('stakeAdjustment.finalExecutableStakeContract')));
c('decision truth usa contract',()=>assert(pub.includes('const contract = resolveTennisStakeExecutionContractUi(row);')));
c('cache buster Patch46 o successivo',()=>assert(/app\.js\?v=patch(?:46-stake-authority-semantic-separation-final-executable-contract|47-clv-degraded-ledger-idempotent-evidence-terminal-states|48-r2-operational-authority-forward-reconcile-canonical-deepscan|48-r3-structured-migration-fixpoint-reconcile|48-r4-unbounded-lifecycle-reconcile|48-r5-continuous-clv-ledger-onboarding|49-analysis-memory-prediction-index-bands-ai-reliability|50-health-check-alignment-prediction-index-collapse|51-settlement-exception-queue-idempotent-notifications|52-wta-information-recovery|53-clv-cross-sport-coverage)/.test(index)));
console.log(JSON.stringify({success:true,patch:'46',checks},null,2));
