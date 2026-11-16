'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const out=process.argv[3] ? path.resolve(process.argv[3]) : null;
const M=require(path.join(root,'backend/markov'));
const K=require(path.join(root,'backend/calcioKellyStakePolicy'));
const C=require(path.join(root,'backend/calcioQuantEngine'));
const S=require(path.join(root,'backend/simulation'));
const T=require(path.join(root,'backend/tennisMatchFormat'));
const cases=[];function check(id,fn){try{fn();cases.push({id,pass:true});}catch(e){cases.push({id,pass:false,error:e.message});}}
function near(a,b,t=1e-9){assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=t,`${a} != ${b}`);}
function input(bankroll=1000,kellyPct=.1,score=75){return {bankroll,kellyPct,predictionReliability:{score,evidenceAuthority:score>=85?'HIGH_AUTHORITY':'PROXY_OR_PARTIAL'},professionalAudit:{dataReliability:{score}},probabilityIntegrity:{diagnostics:{'1':{disagreementPp:1,monteCarloStdErrorPp:.1}}},market:'1'};}
function preserved(){return {
 games:[.1,.3,.5,.64,.9].map(p=>M.probGame(p)),
 gameWithBreakPoint:M.probGame(.64,.55),
 tieBreak:M.probTieBreak(.64,.61,{iterations:1000,seed:19}),
 elo:C.getEloProbabilities(1600,1500),
 dixonColes:C.getDixonColesProbabilities(1.55,1.1,-.1),
 noVig:C.calculateNoVigOdds({'1':2,X:3,'2':4}),
 edgeEv:[C.calculateEdgePp(60,2),C.calculateEvPct(60,2)],
 kelly:C.calculateKelly(60,2,0),
 rng:Array.from({length:8},M.createSeededRng(19)),
 format:[T.resolveTennisMatchFormat({tourType:'ATP',sportTitle:'ATP Wimbledon'}),T.resolveTennisMatchFormat({tourType:'WTA',sportTitle:'WTA Wimbledon'})],
};}
if(process.argv.includes('--capture-preserved')){fs.writeFileSync(out,JSON.stringify(preserved(),null,2));process.exit(0);}
check('revision_tags',()=>{assert.equal(M.MARKOV_ENGINE_VERSION,'5.0-PATCH19-AUDIT02');assert.ok(K.CALCIO_KELLY_STAKE_POLICY_VERSION.endsWith('_AUDIT01'));});
for(const start of [true,false])check('F01_tiebreak_next_server_'+start,()=>{let n=0;const s=M.simulateSetOnce({pA:.99,pB:.99,rng:()=>{const i=n++-12;return i<0?.1:((i%4===0||i%4===3)?start:!start)?0:.999;},startServerIsA:start});assert.equal(s.totalGames,13);assert.equal(s.tieBreakPlayed,true);assert.equal(s.nextServerIsA,!start);});
for(const start of [true,false])check('F01_match_service_continuity_'+start,()=>{const rng=M.createSeededRng(917),r=M.simulateMatchOnce({pA:.8,pB:.78,bestOf:5,rng,startServerIsA:start});const replay=M.createSeededRng(917);let next=start;let sets=[];for(const ignored of r.setScores){const s=M.simulateSetOnce({pA:.8,pB:.78,rng:replay,startServerIsA:next});assert.equal(s.nextServerIsA,s.totalGames%2?!next:next);next=s.nextServerIsA;sets.push([s.gamesA,s.gamesB]);}assert.deepEqual(sets,r.setScores.map(x=>[x.gamesA,x.gamesB]));});
for(const gameCount of [6,7])check('no_tiebreak_service_'+gameCount,()=>{const winners=gameCount===6?[true,true,true,true,true,true]:[false,true,true,true,true,true,true];let i=0;const s=M.simulateSetOnce({pA:.5,pB:.5,startServerIsA:true,rng:()=>{const serverA=i%2===0;return winners[i++]===serverA?0:.99;}});assert.equal(s.totalGames,gameCount);assert.equal(s.tieBreakPlayed,false);assert.equal(s.nextServerIsA,gameCount%2===0);});
check('F04_exact_empirical_probability',()=>{
 const vm=require('vm'), source=fs.readFileSync(path.join(root,'backend/markov.js'),'utf8');
 const box={module:{exports:{}},exports:{},require:require("module").createRequire(path.join(root,"backend/markov.js")),console};
 vm.runInNewContext(source+`;const originalMatch=simulateMatchOnce; const samples=[]; simulateMatchOnce=function(args){const r=originalMatch(args);samples.push(r.totalTieBreaks);return r;};module.exports.auditSamples=samples;`,box);
 const m=box.module.exports, result=m.runProfessionalMarkovMatchModel({pA:.64,pB:.61,iterations:1000,seed:19});
 const samples=m.auditSamples;
 assert.equal(samples.length,result.iterations);
 near(result.probabilities.tieBreak,Number((samples.filter(n=>n>0).length/samples.length).toFixed(4)));
 near(result.expectedTieBreaks,Number((samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(4)));
});
let model;
check('F04_probability_and_expected_count',()=>{model=M.runProfessionalMarkovMatchModel({pA:.9,pB:.9,bpA:.9,bpB:.9,sampleA:5000,sampleB:5000,bestOf:5,iterations:1000,seed:1});const p=model.probabilities.tieBreak,e=model.expectedTieBreaks;assert.ok(p>=0&&p<=1);assert.ok(e>1&&e<=5);assert.ok(e>=p&&e<=5*p+.001);assert.equal(model.tieBreakProbabilityDefinition,'AT_LEAST_ONE_TIE_BREAK_IN_MATCH');near(model.probabilities.player1+model.probabilities.player2,1);});
check('F04_simulation_adapter',()=>{const x=S.runTennisMonteCarlo({player1:.55},{p1ServePoint:.64,p2ServePoint:.6,iterations:1000,seed:19});assert.ok(x.probabilities.tieBreak>=0&&x.probabilities.tieBreak<=1);assert.ok(Number.isFinite(x.expectedTieBreaks));assert.equal(x.markovEngineVersion,M.MARKOV_ENGINE_VERSION);assert.equal(x.tieBreakProbabilityDefinition,'AT_LEAST_ONE_TIE_BREAK_IN_MATCH');});
check('F05_cap_less_than_minimum',()=>{const s=K.calculateTheoreticalStake(input(100,.5));assert.equal(s.theoreticalStake,0);assert.equal(s.minimumStakeApplied,false);near(s.capStake,1.25);});
check('F05_existing_minimum_preserved_when_allowed',()=>{const s=K.calculateTheoreticalStake(input(1000,.1,62));assert.equal(s.theoreticalStake,2);assert.equal(s.minimumStakeApplied,true);});
check('F05_existing_large_stake_preserved',()=>{near(K.calculateTheoreticalStake(input(1000,1,75)).theoreticalStake,8);near(K.calculateTheoreticalStake(input(1000,3,90)).theoreticalStake,20);});
check('F05_bankroll_and_cap_grid',()=>{for(const b of [0,1,1.99,2,10,99.99,100,159.99,160,160.39,266.66,266.67,1000])for(const k of [0,.001,.1,.5,1,3,100])for(const score of [54,62,75,90]){const s=K.calculateTheoreticalStake(input(b,k,score));const cap=b*(score>=85?2:score>=70?1.25:.75)/100;assert.ok(s.theoreticalStake<=cap+1e-9);assert.ok(s.theoreticalStake<=b+1e-9);assert.ok(s.theoreticalStake===0||s.theoreticalStake>=2);if(score<55||k===0)assert.equal(s.theoreticalStake,0);}});
check('F05_hard_multiplier_zero',()=>assert.equal(K.calculateTheoreticalStake({...input(),professionalMultiplier:0}).theoreticalStake,0));
check('F05_rounding_does_not_cross_cap',()=>{const s=K.calculateTheoreticalStake(input(200.79,100));assert.ok(s.theoreticalStake<=200.79*.0125);near(s.theoreticalStake,2.5);});
check('F05_normalizer',()=>{for(const [v,cap,expected] of [[1,1.25,0],[1,10,2],[10,2.005,2],[10,2.999,2.99],[0,10,0]])near(K.normalizePositiveOperationalStake(v,{maximum:cap}),expected);assert.equal(K.normalizePositiveOperationalStake(2,{maximum:NaN}),0);});
check('seed_determinism',()=>{const args={pA:.64,pB:.6,bestOf:3,iterations:1200,seed:19019};assert.deepEqual(M.runProfessionalMarkovMatchModel(args),M.runProfessionalMarkovMatchModel(args));});
check('totals_mass_and_push',()=>{for(const line of [22,22.5]){const a=M.simulateTotals({pA:.64,pB:.61,targetLine:line,bestOf:3,iterations:1000,seed:19});near(a.probOver+a.probUnder,1,.001);assert.ok(a.pushRate>=0&&a.pushRate<=1);if(line===22.5)assert.equal(a.pushRate,0);}});
check('unchanged_functions_against_prepatch_baseline',()=>assert.deepEqual(preserved(),JSON.parse(fs.readFileSync(path.join(root,'tools/fixtures/audit01-preserved.json'),'utf8'))));
for(const file of ['test-tennis-patch19-professional-engine-fixtures.js','test-tennis-patch56-policy.js','test-tennis-patch57-security-policy.js'])check('existing_'+file,()=>{const r=spawnSync(process.execPath,[path.join(root,'tools',file),'--root',root],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});assert.equal(r.status,0,`${r.error?.message||''}\n${r.stderr}\n${r.stdout}`);const j=JSON.parse(r.stdout);assert.equal(j.success,true);});
const report={patch:'AUDIT01',scope:'F01 F04 F05; offline module/integration checks, not a production release authorization',node:process.version,generatedAt:new Date().toISOString(),pass:cases.every(x=>x.pass),passed:cases.filter(x=>x.pass).length,failed:cases.filter(x=>!x.pass).length,cases,modelExample:model?{probabilities:model.probabilities,expectedTieBreaks:model.expectedTieBreaks}:null};
if(out){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));}
console.log(JSON.stringify(report,null,2));process.exitCode=report.pass?0:1;
