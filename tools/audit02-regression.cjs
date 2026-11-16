'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{spawnSync}=require('child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),out=path.resolve(process.argv[3]||'audit02-regression.json');
const M=require(path.join(root,'backend/markov')),R=require(path.join(root,'backend/tennisScoringRulesAudit02')),S=require(path.join(root,'backend/tennisSettlementContract')),Sim=require(path.join(root,'backend/simulation')),E=require(path.join(root,'backend/tennisProfessionalStatisticalEnsemble'));
const cases=[];function test(id,fn){try{fn();cases.push({id,pass:true});}catch(e){cases.push({id,pass:false,error:e.stack});}}
const base={home_team:'Alpha One',away_team:'Beta Two',match_date:'2026-09-01T10:00:00Z',league:'ATP US Open',tennis_event_fingerprint:'event',tennis_market_fingerprint:'market',market_type:'MONEYLINE'};
const result={source:'ODDS_API_SCORES',sourceEventId:'fixture',winner:1,winnerName:'Alpha One',score:'6-4 6-3 6-2',observedAt:'2026-09-01T14:00:00Z',providerCompleted:true};
function settle(a={},b={}){return S.evaluateTennisSettlementContract({...base,...a},{...result,...b});}
function blocked(a,b){const r=settle(a,b);assert.equal(r.autoSettleAllowed,false,JSON.stringify(r));}
for(const tour of ['ATP','WTA'])for(const slam of ['Australian Open','Roland Garros','Wimbledon','US Open'])for(const q of [false,true])test(`format_${tour}_${slam}_${q}`,()=>{const r=R.resolveScoringRules({sportTitle:tour+' '+slam,round:q?'Q1':'Final'});assert.equal(r.supported,true);assert.equal(r.bestOf,tour==='ATP'&&!q?5:3);assert.equal(r.finalSetTieBreakTarget,10);});
for(const name of ['ATP Rome','WTA Berlin','ATP Challenger'])test('standard_'+name,()=>assert.equal(R.resolveScoringRules({sportTitle:name}).finalSetTieBreakTarget,7));
for(const name of ['ATP Doubles','WTA ITF Qualifying','ATP Next Gen','Wimbledon','ATP Exhibition','ATP Olympics'])test('unsupported_'+name,()=>{const rules=R.resolveScoringRules({sportTitle:name});assert.equal(rules.supported,false);assert.throws(()=>M.runProfessionalMarkovMatchModel({scoringRules:rules,iterations:1000}),/UNSUPPORTED/);});
test('historical_slam_block',()=>assert.equal(R.resolveScoringRules({sportTitle:'ATP Wimbledon',match_date:'2019-07-01'}).supported,false));
for(const target of [7,10])for(const start of [true,false])test(`tiebreak_${target}_${start}`,()=>{let i=0;const a=M.simulateTieBreakOnce({pA:.6,pB:.6,targetPoints:target,startServerIsA:start,rng:()=>{const server=(i%4===0||i%4===3)?start:!start;i++;return server?0:.999;}});assert.equal(a.scoreA,target);assert.equal(a.scoreB,0);assert.equal(a.totalPoints,target);});
for(const target of [7,10])test('tiebreak_deuce_'+target,()=>{let i=0;const desired=Array.from({length:2*(target-1)},(_,n)=>n%2===0).concat([true,true]);const x=M.simulateTieBreakOnce({pA:.6,pB:.6,targetPoints:target,rng:()=>{const server=i%4===0||i%4===3,w=desired[i++];return server===w?0:.999;}});assert.equal(x.scoreA,target+1);assert.equal(x.scoreB,target-1);});
for(const bestOf of [3,5])for(const start of [true,false])test(`decisive_set_only_${bestOf}_${start}`,()=>{
 const seq=[];let server=start;
 for(let set=0;set<bestOf;set++){seq.push(...Array(12).fill(0));const winnerA=set%2===0,target=set===bestOf-1?10:7;
 for(let i=0;i<target;i++){const serveA=(i%4===0||i%4===3)?server:!server;seq.push(serveA===winnerA?0:.999);}server=!server;}
 let i=0;const a=M.simulateMatchOnce({pA:.99,pB:.99,bestOf,finalSetTieBreakTarget:10,startServerIsA:start,rng:()=>{assert.ok(i<seq.length);return seq[i++];}});
 assert.equal(a.setScores.length,bestOf);assert.equal(i,seq.length);assert.equal(a.totalGames,bestOf*13);assert.equal(a.winner,'A');
});
test('invalid_target',()=>assert.throws(()=>M.simulateTieBreakOnce({targetPoints:8}),/INVALID/));
test('truncation_not_a_result',()=>assert.throws(()=>M.simulateSetOnce({pA:.99,pB:.99,rng:()=>0}),/TRUNCATED/));
test('match_tiebreak_not_full_set',()=>assert.throws(()=>R.modelRules({matchTieBreak:true}),/UNSUPPORTED/));
test('conflicting_bestof',()=>assert.throws(()=>R.modelRules({bestOf:3,scoringRules:R.resolveScoringRules({sportTitle:'ATP Wimbledon'})}),/CONFLICT/));
for(const score of ['1-0','6-4','6-4 3-6','6-4 6-4','6-0 6-0 6-0 6-0','6-5 6-2 6-1','8-6 6-2 6-1','6-6 6-2 6-1','6-4 junk 6-3 6-2','6-4 6-3 6-2 0','6-4 6-3 [10-8]','6-4(3) 6-2 6-1','6-4 6-2 7-6(7-6)'])test('invalid_score_'+score,()=>blocked({}, {score}));
for(const score of ['6-4 6-3 6-2','6-4 3-6 6-2 6-1','6-4 3-6 6-2 1-6 7-6(10-8)','6-4, 3-6, 6-2, 1-6, 7-6(8)','6–4 6–3 6–2'])test('valid_bo5_'+score,()=>assert.equal(settle({}, {score}).autoSettleAllowed,true));
test('wrong_decisive_tb_points',()=>blocked({}, {score:'6-4 3-6 6-2 1-6 7-6(7-5)'}));
test('wrong_nondecisive_tb_points',()=>blocked({}, {score:'7-6(10-7) 6-2 6-1'}));
test('valid_bo3',()=>assert.equal(settle({league:'WTA US Open'},{score:'6-4 6-2'}).autoSettleAllowed,true));
test('too_many_bo3',()=>blocked({league:'WTA US Open'},{score:'6-4 6-2 6-1'}));
test('canonical_away_winner',()=>assert.equal(settle({}, {score:'4-6 3-6 2-6',winner:2,winnerName:'Beta Two'}).autoSettleAllowed,true));
test('winner_first_away',()=>assert.equal(settle({}, {winner:2,winnerName:'Beta Two',scoreOrientation:'WINNER_FIRST'}).autoSettleAllowed,true));
test('score_winner_mismatch',()=>blocked({}, {winner:2,winnerName:'Beta Two'}));
test('winner_name_mismatch',()=>blocked({}, {winnerName:'Beta Two'}));
test('unknown_orientation',()=>blocked({}, {scoreOrientation:'AUTO'}));
test('provider_false_complete_score',()=>blocked({}, {providerCompleted:false}));
test('provider_string_false',()=>blocked({}, {providerCompleted:'false'}));
test('provider_complete_no_score_moneyline',()=>assert.equal(settle({}, {score:null}).autoSettleAllowed,true));
test('provider_incomplete_no_score',()=>blocked({}, {score:null,providerCompleted:false}));
test('certified_missing_score',()=>blocked({}, {score:null,source:'ATP_OFFICIAL_RESULTS_PATCH29'}));
for(const score of ['6-4 2-1 RET','SUSPENDED','W/O','CANCELLED','VOID','6-4 6-3 6-2 RET'])test('exception_'+score,()=>blocked({}, {score}));
test('explicit_void_manual',()=>blocked({}, {winner:'VOID',isVoid:true,score:null}));
test('explicit_rule_review',()=>blocked({}, {requiresBookmakerRule:true}));
test('explicit_automatic_false',()=>blocked({}, {automaticSettlement:false}));
test('unsupported_settlement',()=>blocked({league:'ATP Doubles'},{}));
test('totals_consistent',()=>assert.equal(settle({market_type:'TOTAL_GAMES'},{totalGames:27}).autoSettleAllowed,true));
for(const val of [null,'',true,28,27.2])test('totals_bad_'+String(val),()=>blocked({market_type:'TOTAL_GAMES'},{totalGames:val}));
test('totals_missing_score',()=>blocked({market_type:'TOTAL_GAMES'},{totalGames:27,score:null}));
test('weak_source_never_auto',()=>blocked({}, {source:'WEB_FALLBACK'}));
test('evidence_before_start',()=>blocked({}, {observedAt:'2026-09-01T09:00:00Z'}));
test('side_without_name_consistency',()=>blocked({}, {winnerName:'',winner:2}));
test('evidence_hash_changes_with_orientation',()=>assert.notEqual(settle().evidenceHash,settle({}, {scoreOrientation:'WINNER_FIRST'}).evidenceHash));
const rules=R.resolveScoringRules({sportTitle:'ATP Wimbledon'});
test('simulation_adapter_rules',()=>{const a=Sim.runTennisMonteCarlo({player1:.5},{p1ServePoint:.7,p2ServePoint:.69,scoringRules:rules,iterations:1000});assert.equal(a.scoringRules.finalSetTieBreakTarget,10);assert.equal(a.scoringRules.bestOf,5);});
test('ensemble_wiring',()=>{const a=E.buildBestAvailableForecast({scoringRules:rules,bestOf:5,p1ServePoint:.7,p2ServePoint:.69,markovIterations:1200,monteCarloIterations:1200});assert.ok(JSON.stringify(a).includes('ITF_GRAND_SLAM_RULEBOOK_2026'));});
// Execute the actual server adapter function without starting Express or scheduler.
test('live_totals_adapter',()=>{const code=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');const start=code.indexOf('function hasMarkovFunction('),end=code.indexOf('function normalizeMarkovTotalsResult(',start);const box={MarkovEngine:{simulateTotals:(...a)=>a}};vm.runInNewContext(code.slice(start,end),box);const args=box.markovSimulateTotals(.7,.69,39.5,5,null,null,rules);assert.equal(args[6].scoringRules,rules);assert.ok(code.includes('model.p2Clutch,\n                                scoringRules'));assert.ok(code.includes('scoringRules,\n                        round: patch19Round'));});
test('standard_model_AUDIT01_golden',()=>{const old=JSON.parse(fs.readFileSync(path.join(root,'tools/fixtures/audit02-standard-baseline.json'),'utf8'));const args={pA:.64,pB:.61,bestOf:3,iterations:1000,seed:19019};const a=M.runProfessionalMarkovMatchModel(args);for(const k of ['probabilities','expectedGames','expectedTieBreaks','scoreDistribution'])assert.deepEqual(a[k],old[k]);const t=M.simulateTotals({...args,targetLine:22.5});for(const k of ['probOver','probUnder','expectedGames','pushRate','tieBreakRate'])assert.equal(t[k],old.totals[k]);});
test('official_adapter_away_winner_first',()=>{const O=require(path.join(root,'backend/tennisOfficialSettlementResolver'));const seed=O.loadSeed();let checked=0;for(const record of seed.records){const row={...base,home_team:record.winner===record.home?record.away:record.home,away_team:record.winner,league:record.tour+' '+(record.tournament||''),match_date:record.date};const r=O.resolveFromSeed(row);if(!r)continue;assert.equal(r.scoreOrientation,'WINNER_FIRST');assert.equal(r.winner,2);const c=S.evaluateTennisSettlementContract(row,r);assert.equal(c.autoSettleAllowed,true,JSON.stringify(c));checked++;}assert.ok(checked>0);});
test('truth_R4_winner_first',()=>{const T=require(path.join(root,'backend/tennisSettlementTruthPatch34R4'));for(const rec of T.loadCompletedSeed().records){const row={...base,id:rec.betId,home_team:rec.home,away_team:rec.away,league:rec.tour+' '+(rec.tournament||''),match_date:rec.date};const res=T.resolve(row);assert.ok(res);assert.equal(res.scoreOrientation,'WINNER_FIRST');const c=S.evaluateTennisSettlementContract(row,res);assert.equal(c.scoreAudit.valid,true);assert.ok(c.scoreAudit.setsWon.includes(2));assert.equal(c.autoSettleAllowed,false);assert.equal(c.reason,'SOURCE_TIER_UNKNOWN_SOURCE_REQUIRES_REVIEW');}});
test('cache_orientation_preserved',()=>{const code=fs.readFileSync(path.join(root,'backend/paperTrading.tennis.js'),'utf8');assert.ok(code.includes("scoreOrientation: cachedVault.scoreOrientation || 'UNKNOWN'"));blocked({}, {scoreOrientation:'UNKNOWN'});});
test('AUDIT01_cumulative',()=>{const p=spawnSync(process.execPath,[path.join(root,'tools/audit01-regression.cjs'),root,path.join(path.dirname(out),'audit01_cumulative.json')],{encoding:'utf8',timeout:180000});assert.equal(p.status,0,p.stdout+p.stderr);const j=JSON.parse(p.stdout);assert.equal(j.passed,23);});
const report={patch:'AUDIT02',node:process.version,pass:cases.every(x=>x.pass),passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,cases};fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,passed:report.passed,failed:report.failed,failures:cases.filter(x=>!x.pass)},null,2));process.exitCode=report.pass?0:1;
