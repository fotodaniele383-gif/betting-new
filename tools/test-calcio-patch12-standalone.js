'use strict';
const fs=require('fs');const path=require('path');const os=require('os');const assert=require('assert');const {DatabaseSync}=require('node:sqlite');
const ledgerModule=require('../backend/oddsApiUsageLedger');
const identity=require('../backend/paperTradingIdentity');
const selector=require('../backend/calcioProfessionalSelection');
const providers=require('../backend/calcioMultiProviderEvidence');
const optimizer=require('../backend/calcioHistoricalThresholdOptimizer');
function check(name,fn,checks){try{fn();checks.push({name,ok:true});}catch(e){checks.push({name,ok:false,error:e.message});}}
function dbAdapter(file){const db=new DatabaseSync(file);db.transaction=fn=>(...args)=>{db.exec('BEGIN IMMEDIATE');try{const r=fn(...args);db.exec('COMMIT');return r;}catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}};return db;}
function main(){
 const root=path.resolve(__dirname,'..');const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'betting-p12-'));const checks=[];const diagnostics={};
 check('Exact Odds API headers increment from legacy baseline by x-requests-last',()=>{
   const file=path.join(tmp,'ledger.json');const l=ledgerModule.createLedger({file,nowFn:()=>new Date('2026-07-22T14:00:00Z')});
   assert.equal(l.summary({creditsUsed:149,requestAttempts:149,keyCount:14,monthlyCreditTotal:7000}).creditsUsed,149);
   const a=l.recordAttempt({key:'key-a',operation:'calcio_live_odds'});l.recordResponse({attemptId:a.attemptId,key:'key-a',operation:'calcio_live_odds',headers:{'x-requests-used':'12','x-requests-remaining':'488','x-requests-last':'2'},statusCode:200});
   assert.equal(l.summary({creditsUsed:149,requestAttempts:149,keyCount:14,monthlyCreditTotal:7000}).creditsUsed,151);
   const b=l.recordAttempt({key:'key-a',operation:'sports_catalog'});l.recordResponse({attemptId:b.attemptId,key:'key-a',operation:'sports_catalog',headers:{'x-requests-used':'12','x-requests-remaining':'488','x-requests-last':'0'},statusCode:200});
   const summary=l.summary({creditsUsed:149,requestAttempts:149,keyCount:14,monthlyCreditTotal:7000});assert.equal(summary.creditsUsed,151);assert.equal(summary.lastCall.credits,0);assert.equal(summary.requestAttempts,151);assert.equal(summary.providerRequestAttempts,2);assert(!JSON.stringify(summary).includes('key-a'));diagnostics.apiLedger=summary;
 },checks);
 check('Paper identity canonicalizes ISO and legacy local-date rows',()=>{
   const a=identity.buildPaperResultKey({sport_type:'CALCIO',match_date:'2026-08-23T18:45:00.000Z',home_team:'Atalanta',away_team:'Sassuolo',prediction:'2',bet_type:'SINGLE'});
   const b=identity.buildPaperResultKey({sport_type:'CALCIO',match_date:'23/08, 20:45',home_team:'Atalanta',away_team:'Sassuolo',prediction:'2',bet_type:'SINGLE'});
   assert.equal(a,b); diagnostics.paperKey=a;
 },checks);
 check('Non-destructive dedup leaves one active row and flags settlement conflicts',()=>{
   const file=path.join(tmp,'paper.db');const db=dbAdapter(file);db.exec("CREATE TABLE ai_forward_test(id INTEGER PRIMARY KEY AUTOINCREMENT,bet_type TEXT,match_date TEXT,home_team TEXT,away_team TEXT,prediction TEXT,odd REAL,stake REAL,status TEXT,profit REAL,league TEXT,sport_type TEXT,data_quality TEXT)");
   const ins=db.prepare('INSERT INTO ai_forward_test(bet_type,match_date,home_team,away_team,prediction,odd,stake,status,profit,league,sport_type,data_quality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
   ins.run('SINGLE','23/08, 20:45','Atalanta','Sassuolo','2',6.2,0,'PENDING',0,'Serie A','CALCIO','CURRENT_BOOTSTRAP');
   ins.run('SINGLE','2026-08-23T18:45:00.000Z','Atalanta','Sassuolo','2',6.1,0,'PENDING',0,'Serie A','CALCIO','CURRENT_BOOTSTRAP');
   ins.run('SINGLE_TENNIS','2026-07-10T10:00:00Z','Player A','Player B','1',1.8,10,'WON',8,'ATP','TENNIS','CURRENT');
   ins.run('SINGLE_TENNIS','10/07/2026, 12:00','Player B','Player A','1',1.8,10,'LOST',-10,'ATP','TENNIS','CURRENT');
   const report=identity.repairDuplicates(db,{now:'2026-07-22T14:00:00Z'});assert.equal(report.duplicateGroups,2);assert.equal(report.existingColumnsPreserved,true);assert.equal(report.mergedFields,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE paper_result_active=1').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM ai_forward_test WHERE paper_result_active=1 AND paper_result_conflict=1').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM (SELECT paper_result_key,COUNT(*) c FROM ai_forward_test WHERE paper_result_active=1 GROUP BY paper_result_key HAVING c>1)').get().n,0);diagnostics.dedup=report;db.close();
 },checks);
 check('Risk-adjusted selector prefers robust core odds over raw-edge longshot',()=>{
   const r=selector.selectPrimary([
     {prediction:'2',odd:8,rawProb:18,edge_pp:5.5,ev_pct:44,prediction_reliability_score:55,professionalAudit:{riskScore:28},stake_theoretical:0,analysisOnly:true},
     {prediction:'1X',odd:1.9,rawProb:58,edge_pp:5.37,ev_pct:10.2,prediction_reliability_score:74,professionalAudit:{riskScore:18},stake_theoretical:8,analysisOnly:false}
   ]);assert.equal(r.selected.prediction,'1X');diagnostics.selection=r.ranked.map(x=>({prediction:x.prediction,score:x.candidate_selection_score,tier:x.candidate_selection_tier}));
 },checks);
 check('Multi-provider policy is zero-key/cache first and does not inflate probability',()=>{
   const h=providers.buildEvidenceHealth({footballDataLoaded:true,hasBothXg:false,sourceAudit:{coveragePct:80},oddsAvailable:true});assert.equal(h.providers[0].cost,'ZERO_KEY');assert.equal(h.providers[h.providers.length-1].id,'THE_ODDS_API');assert.equal(h.safeguards.noProbabilityInflationFromProviderCount,true);diagnostics.providers=h;
 },checks);
 check('Historical auto-optimization uses chronological holdout and never mutates settings',()=>{
   const report=optimizer.run(root,{minimumCalibration:80});assert.equal(report.safeguards.holdoutExcludedFromSelection,true);assert.equal(report.safeguards.noAutomaticSettingsMutation,true);assert(report.recommended && report.recommended.holdout.sample>0);assert(['1X2_ONLY','TOTALS_ONLY','ALL_SUPPORTED'].includes(report.recommended.marketScope));diagnostics.optimizer={status:report.status,recommendationId:report.recommendationId,recommended:report.recommended};
 },checks);
 check('onlyGlobal no longer excludes 1, X2 or U2.5',()=>{const source=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');assert(!source.includes("onlyGlobal && ['U2.5', '1', 'X2'].includes(pred)"));assert(source.includes('onlyGlobal sceglie le soglie globali ma NON elimina mercati'));},checks);
 check('Trading UI exposes multi-select and bulk soft-delete',()=>{const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');assert(app.includes('selectedForwardBetIds'));assert(app.includes('/api/bets/bulk-action'));assert(html.includes('forwardBulkToolbar'));},checks);
 check('Production Odds API paths use response-header ledger, not fixed debit',()=>{for(const f of ['backend/server.js','backend/server.tennis.js','backend/oddsService.js']){const src=fs.readFileSync(path.join(root,f),'utf8');assert(src.includes('recordOddsApiResponse'));assert(!src.includes('recordOddsApiUsage({'));}},checks);
 check('Global maximum odd is visible and enforced in live/backtest',()=>{const source=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');assert(html.includes('cfg_maxOdd'));assert(source.includes('effectiveMaxOdd'));assert(source.includes('odd <= effectiveMaxOdd'));},checks);
 check('Backtest and production share risk-adjusted market selection',()=>{const source=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');assert(source.includes('eligibleBacktestCandidates'));assert(source.includes('calcioProfessionalSelection.selectPrimary(eligibleBacktestCandidates)'));},checks);
 check('Auto optimization is multi-market, scope-aware and holdout gated',()=>{const source=fs.readFileSync(path.join(root,'backend','calcioHistoricalThresholdOptimizer.js'),'utf8');assert(source.includes("'TOTALS_2_5'"));assert(source.includes('marketScopes'));assert(source.includes('holdoutExcludedFromSelection:true'));},checks);
 const success=checks.every(c=>c.ok);const out={success,patch:'BETTING_PATCH_12',version:'BETTING_PATCH_12_PROFESSIONAL_RUNTIME_CONTROL',checks,diagnostics};console.log(JSON.stringify(out,null,2));if(!success)process.exitCode=1;
}
try{main();}catch(e){console.error(e.stack||e.message);process.exit(1);}
