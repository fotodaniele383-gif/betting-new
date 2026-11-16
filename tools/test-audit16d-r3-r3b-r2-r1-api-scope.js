'use strict';
const fs=require('fs');
const os=require('os');
const path=require('path');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]:path.join(__dirname,'..'));
const enrichment=require(path.join(ROOT,'backend','calcioSerieBApiFootballEnrichmentAudit16dR3R3bR2'));
function baseModel(){return {teams:{Vicenza:{xG_for:1.4,xG_against:1.5,games:5,source:'FOOTBALL_DATA_CSV_SHOTS_SOT',providerId:'SERIE_B_ESTIMATED_XG',evidenceClass:'MODEL_ESTIMATED_XG',modelEstimated:true},Catanzaro:{xG_for:1.3,xG_against:1.6,games:5,source:'FOOTBALL_DATA_CSV_SHOTS_SOT',providerId:'SERIE_B_ESTIMATED_XG',evidenceClass:'MODEL_ESTIMATED_XG',modelEstimated:true}},state:{status:'MODEL_READY',sourceClass:'MODEL_ESTIMATED',evidenceClass:'MODEL_ESTIMATED_XG',leagueName:'Serie B',season:'2627',seasonStart:2026,authorityWeight:0.2,source:'FOOTBALL_DATA_CSV_SHOTS_SOT',directStakeAuthority:false,directGateAuthority:false,realXg:false},diagnostics:{}}}
function add(name,ok,details){return {name,ok:Boolean(ok),details:details??null}}
(async()=>{
 const checks=[];
 checks.push(add('R2_R1 scope version exported',enrichment.AUDIT16D_R3_R3B_R2_R1_SCOPE_VERSION==='AUDIT16D_R3_R3B_R2_R1_API_SCOPE_AND_PROBE_EXIT_FIX_V1',enrichment.AUDIT16D_R3_R3B_R2_R1_SCOPE_VERSION));
 checks.push(add('Stable Serie B league id exported',enrichment.SERIE_B_LEAGUE_ID===135,enrichment.SERIE_B_LEAGUE_ID));
 const calls=[];
 const reqUnavailable=async(url,key)=>{calls.push(url); if(!url.includes('/leagues?id=135')) throw new Error('UNEXPECTED_NETWORK_AFTER_DISCOVERY'); return {status:200,headers:{},json:{response:[{league:{id:135,name:'Serie B'},country:{name:'Italy'},seasons:[{year:2024,coverage:{}},{year:2025,coverage:{}}]}]}}};
 const unavailable=await enrichment.enrichBaseModel(baseModel(),{env:{API_FOOTBALL_KEY:'X'},cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'r2r1-unavailable-')),now:new Date('2026-09-28T14:30:00Z'),seasonStart:2026,requestJson:reqUnavailable});
 checks.push(add('League discovery is season-agnostic first',calls.length===1&&calls[0].includes('/leagues?id=135'),calls));
 checks.push(add('Unavailable free-plan season is explicit',unavailable.state.enrichmentStatus==='BASE_ONLY_SEASON_NOT_AVAILABLE_ON_PLAN',unavailable.diagnostics.apiFootball));
 checks.push(add('Unavailable season reports available seasons',JSON.stringify(unavailable.diagnostics.apiFootball.availableSeasons)===JSON.stringify([2024,2025]),unavailable.diagnostics.apiFootball.availableSeasons));
 checks.push(add('Unavailable season keeps base authority unchanged',unavailable.state.realXg===false&&unavailable.state.authorityWeight<=0.2&&unavailable.state.directStakeAuthority===false&&unavailable.state.directGateAuthority===false,unavailable.state));
 const apiErr=new Error('API_FOOTBALL_API_ERRORS'); apiErr.status=200; apiErr.apiErrors=['plan: season unavailable'];
 const providerErr=await enrichment.enrichBaseModel(baseModel(),{env:{API_FOOTBALL_KEY:'X'},cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'r2r1-error-')),now:new Date('2026-09-28T14:31:00Z'),seasonStart:2026,requestJson:async()=>{throw apiErr;}});
 checks.push(add('API-level errors are surfaced distinctly',providerErr.state.enrichmentStatus==='BASE_ONLY_API_PROVIDER_ERROR'&&providerErr.diagnostics.apiFootball.apiErrors?.[0]==='plan: season unavailable',providerErr.diagnostics.apiFootball));
 const normalized=enrichment._private.normalizeApiErrors({plan:'not allowed',rate:['slow']});
 checks.push(add('API errors normalize without token data',normalized.includes('plan: not allowed')&&normalized.includes('rate: slow'),normalized));
 const probe=fs.readFileSync(path.join(ROOT,'tools','audit16d-r3-r3b-r2-enrichment-probe.js'),'utf8');
 checks.push(add('Probe avoids abrupt process.exit after fetch',!probe.includes('process.exit(')&&probe.includes('process.exitCode'),null));
 const failed=checks.filter(x=>!x.ok); const out={success:failed.length===0,patch:'AUDIT16D_R3_R3B_R2_R1',suite:'API_FOOTBALL_SCOPE_AND_PROBE_EXIT',checks:checks.length,failures:failed,details:checks}; console.log(JSON.stringify(out,null,2)); process.exitCode=out.success?0:1;
})().catch(e=>{console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R3B_R2_R1',suite:'API_FOOTBALL_SCOPE_AND_PROBE_EXIT',error:e.stack||e.message},null,2));process.exitCode=1;});
