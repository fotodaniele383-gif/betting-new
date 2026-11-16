#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const external=require('../backend/tennisExternalMatchIntelligencePatch37');
const root=path.resolve(process.cwd());function text(p){return fs.readFileSync(path.join(root,p),'utf8');}function json(p){return JSON.parse(text(p));}function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');}
const checks=[];function ck(name,ok,details=null,severity='error'){checks.push({name,ok:Boolean(ok),severity,details});}
const pkg=json('package.json');const lock=json('package-lock.json');const reg=text('backend/tennisPatchRegistry.js');const deep=text('backend/deepScanTennis.js');const server=text('backend/server.tennis.js');const app=text('public/app.js');const index=text('public/index.html');const contract=json('tools/PATCH37_BASELINE_PACKAGE_CONTRACT.json');
ck('package 21.24.0',pkg.version==='21.24.0');ck('lock 21.24.0',lock.version==='21.24.0'&&lock.packages?.['']?.version==='21.24.0');
ck('dependencies unchanged',JSON.stringify(pkg.dependencies||{})===JSON.stringify(contract.dependencies||{})&&JSON.stringify(pkg.devDependencies||{})===JSON.stringify(contract.devDependencies||{}));
ck('registry 37',reg.includes("TENNIS_CURRENT_PATCH_VERSION = '37'")&&reg.includes('TENNIS_PATCH_REGISTRY_V37'));
ck('external module',fs.existsSync(path.join(root,'backend/tennisExternalMatchIntelligencePatch37.js')));
ck('migration module',fs.existsSync(path.join(root,'backend/migrateTennisPatch37.js')));
ck('H2H local structured',deep.includes('LOCAL_STRUCTURED_CSV')&&deep.includes('PATCH37_H2H_TRUTH'));
ck('old H2H extreme inactive',!deep.slice(deep.indexOf('async function scanMatchup')).includes('getTMLStats(p1Name, p2Name)')&&!deep.includes('Bestia Nera')&&!deep.includes('Win Rate pompato'));
ck('H2H cap ±2.5',external.sourceHealth().maxH2hAdjustmentPp===2.5);
ck('official ATP ranking source',external.SOURCE_REGISTRY.ATP_OFFICIAL_RANKINGS.host==='www.atptour.com');
ck('official WTA ranking source',external.SOURCE_REGISTRY.WTA_OFFICIAL_RANKINGS.host==='www.wtatennis.com');
ck('Open-Meteo source',external.SOURCE_REGISTRY.OPEN_METEO_FORECAST.host==='api.open-meteo.com');
ck('host allowlist exact',[...external.ALLOWED_HOSTS].sort().join('|')==='api.open-meteo.com|www.atptour.com|www.wtatennis.com');
ck('Match Charting disabled',external.SOURCE_REGISTRY.MATCH_CHARTING_PROJECT.enabled===false&&external.SOURCE_REGISTRY.MATCH_CHARTING_PROJECT.authority==='DISABLED_RESEARCH_ONLY');
ck('ranking no probability authority',external.sourceHealth().officialRankingProbabilityAuthority===false);ck('weather no probability authority',external.sourceHealth().weatherProbabilityAuthority===false);ck('weather no stake authority',external.sourceHealth().weatherStakeAuthority===false);ck('no auto promotion',external.sourceHealth().automaticPromotion===false);
ck('server health endpoint',server.includes("'/external-match-intelligence-health'"));ck('server probe endpoint',server.includes("'/external-match-intelligence-probe'"));ck('receipt persistence',server.includes('externalIntelligenceReceipt = tennisExternalMatchIntelligencePatch37.persistReceipt'));
ck('frontend patch37 marker',index.includes('patch37-external-match-intelligence-h2h-weather-ranking'));ck('frontend panel',index.includes('tennisPatch37ExternalIntelligencePanel'));ck('frontend loader',app.includes('loadTennisPatch37ExternalIntelligence'));
ck('frontend app mirrors',sha('public/app.js')===sha('backend/public/app.js'));ck('frontend index mirrors',sha('public/index.html')===sha('backend/public/index.html'));
for(const p of ['backend/tennisValueEvaluator.js','backend/tennisQualityGateV2.js','backend/paperTrading.tennis.js','backend/tennisOfficialSettlementResolver.js','backend/tennisSettlementTruthPatch34R4.js','backend/calcioPatchRegistry.js'])ck(`protected exists ${p}`,fs.existsSync(path.join(root,p)));
const slash=String.fromCharCode(47);const forbidden=[`${slash}mnt${slash}data${slash}`,`${slash}home${slash}oai${slash}`,'patch'+'37_work'];for(const p of ['backend/tennisExternalMatchIntelligencePatch37.js','backend/migrateTennisPatch37.js','tools/verify-tennis-patch37.js'])ck(`portable ${p}`,!forbidden.some(x=>text(p).includes(x)));
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_37_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING',revision:'R1_WINDOWS_NODE_EXTERNAL_MATCH_INTELLIGENCE_H2H_WEATHER_RANKING',audit:failed.length?'FAILED':'PASS',checkCount:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,sourceHealth:external.sourceHealth()},null,2));if(failed.length)process.exit(1);
