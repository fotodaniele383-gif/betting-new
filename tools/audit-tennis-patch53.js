#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const {createRequire}=require('module');
function root(){const i=process.argv.indexOf('--root');return path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');}
const projectRoot=root();const details=[];const check=(name,ok,extra=null,severity='error')=>{details.push({name,ok:Boolean(ok),severity,details:extra});if(!ok&&severity==='error')throw new Error(name)};
function openDb(file){try{const req=createRequire(path.join(projectRoot,'package.json'));const B=req('better-sqlite3');return new B(file,{readonly:true});}catch(_){const {DatabaseSync}=require('node:sqlite');return new DatabaseSync(file,{readOnly:true});}}
try{
 const pkg=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8'));
 const lock=JSON.parse(fs.readFileSync(path.join(projectRoot,'package-lock.json'),'utf8'));
 const registry=require(path.join(projectRoot,'backend','tennisPatchRegistry.js'));
 const mod=require(path.join(projectRoot,'backend','clvCrossSportCoveragePatch53.js'));
 const wta=require(path.join(projectRoot,'backend','tennisWtaInformationRecoveryPatch52.js'));
 const inv=JSON.parse(fs.readFileSync(path.join(projectRoot,'backend','tennis_patch_inventory.json'),'utf8'));
 const clvText=fs.readFileSync(path.join(projectRoot,'backend','clvTracker.js'),'utf8');
 const server=fs.readFileSync(path.join(projectRoot,'backend','server.js'),'utf8');
 const tennisServer=fs.readFileSync(path.join(projectRoot,'backend','server.tennis.js'),'utf8');
 check('Package Patch53 future-compatible',Number(pkg.version.split('.')[1])>=40,{actual:pkg.version});
 check('Package lock Patch53 future-compatible',lock.version===pkg.version&&lock.packages?.['']?.version===pkg.version);
 check('Registry corrente >=53',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=53&&String(registry.TENNIS_PATCH_REGISTRY_VERSION).startsWith('TENNIS_PATCH_REGISTRY_V'),registry.getTennisPatchStatus());
 check('Voce Patch52 R2 preservata',registry.PATCHES.some(row=>String(row.version)==='52'&&row.revision==='R2'));
 check('Voce Patch53 registrata',registry.PATCHES.some(row=>String(row.version)==='53'&&/CLV coverage/i.test(row.title)));
 check('Modulo coverage Patch53',mod.VERSION==='CLV_CROSS_SPORT_COVERAGE_V1_PATCH53',mod.VERSION);
 check('Resolver cross-sport Patch53',mod.SPORT_KEY_RESOLUTION_VERSION==='CLV_CROSS_SPORT_SPORT_KEY_RESOLUTION_V1_PATCH53',mod.SPORT_KEY_RESOLUTION_VERSION);
 check('WTA Patch52 R2 preservata',wta.VERSION==='TENNIS_WTA_INFORMATION_RECOVERY_V2_PATCH52_R2',wta.VERSION);
 check('Inventario registry >=53',Number(inv.registry?.currentPatchVersion)>=53&&String(inv.registry?.registryVersion||'').startsWith('TENNIS_PATCH_REGISTRY_V'),inv.registry);
 check('Inventario senza legacy non registrate',Number(inv.summary?.unregisteredCount||0)===0,inv.summary);
 const db=openDb(path.join(projectRoot,'backend','database_betting.db'));
 try{
  const columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(row=>row.name));
  const expected=['clv_cross_sport_resolution_version','clv_cross_sport_sport','clv_cross_sport_sport_key','clv_cross_sport_resolution_status','clv_cross_sport_resolution_source','clv_cross_sport_resolution_confidence','clv_cross_sport_resolution_reason','clv_cross_sport_resolved_at'];
  check('Schema metadata Patch53',expected.every(c=>columns.has(c)),expected.filter(c=>!columns.has(c)));
  const coverage=mod.buildCoverageReport(db,mod.DEFAULT_FOOTBALL_LEAGUES);
  const persisted=mod.persistedSummary(db);
  check('Coverage denominatore coerente',coverage.overall.eligibleRows===coverage.bySport.TENNIS.eligibleRows+coverage.bySport.CALCIO.eligibleRows,coverage.overall);
  check('Calcio sport-key completo',coverage.bySport.CALCIO.eligibleRows>0&&coverage.bySport.CALCIO.sportKeyUnresolvedRows===0,coverage.bySport.CALCIO);
  check('Calcio CLV osservata senza sintesi',coverage.bySport.CALCIO.verifiedClvRows>=0&&coverage.bySport.CALCIO.availableUnverifiedRows>=0&&(coverage.bySport.CALCIO.verifiedClvRows+coverage.bySport.CALCIO.availableUnverifiedRows)<=coverage.bySport.CALCIO.eligibleRows,coverage.bySport.CALCIO);
  check('Tennis CLV verificata separata',coverage.bySport.TENNIS.verifiedClvRows>0&&coverage.bySport.TENNIS.verifiedClvRows<coverage.bySport.TENNIS.eligibleRows,coverage.bySport.TENNIS);
  check('Missing evidence separata',coverage.overall.missingEvidenceRows>=0,{missingEvidenceRows:coverage.overall.missingEvidenceRows,evidenceStates:coverage.evidenceStates});
  check('Nessuna closing sintetica',coverage.invariants.noSyntheticClosingOdds===true&&coverage.invariants.noProbabilityAuthority===true&&coverage.invariants.noStakeAuthority===true,coverage.invariants);
  const persistedCount=db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,'')) IN ('PENDING','WON','LOST') AND UPPER(COALESCE(bet_type,'')) NOT LIKE 'MULTI%' AND UPPER(COALESCE(data_quality,'')) NOT IN ('LEGACY_DIRTY','DIRTY','OLD_METRICS') AND clv_cross_sport_resolution_version=?`).get(mod.SPORT_KEY_RESOLUTION_VERSION);
  const persistedGap=Math.max(0,coverage.overall.eligibleRows-Number(persistedCount.n));
  check('Metadata Patch53 nel solo scope eleggibile',Number(persistedCount.n)<=coverage.overall.eligibleRows,{persisted:Number(persistedCount.n),eligible:coverage.overall.eligibleRows,gap:persistedGap});
  check('Continuous metadata onboarding completo',persistedGap===0,{persisted:Number(persistedCount.n),eligible:coverage.overall.eligibleRows,gap:persistedGap},'warning');
  const unresolvedCalcio=db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE clv_cross_sport_resolution_version=? AND clv_cross_sport_sport='CALCIO' AND COALESCE(clv_cross_sport_sport_key,'')='' ").get(mod.SPORT_KEY_RESOLUTION_VERSION);
  check('Nessun Calcio NON_DETERMINATO',Number(unresolvedCalcio.n)===0,{unresolved:Number(unresolvedCalcio.n)});
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();
  const counts=db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' THEN 1 ELSE 0 END) tennis FROM ai_forward_test").get();
  check('Database integro',String(integrity).toLowerCase()==='ok'&&fk.length===0,{integrity,foreignKeyViolations:fk.length,total:Number(counts.total),tennis:Number(counts.tennis||0)});
  const queueExists=db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='tennis_settlement_exception_queue_patch51'").get();
  check('Settlement Patch51 preservato',Number(queueExists.n)===1);
  check('Persisted summary disponibile',Array.isArray(persisted.rows)&&persisted.rows.length>0,persisted);
 }finally{try{db.close()}catch(_){}}
 check('Tracker usa resolver unico',clvText.includes('resolveSportKeyForBet(bet, LEAGUES_CONFIG')&&clvText.includes('crossSportSportKeyResolution'));
 check('Log NON_DETERMINATO rimosso',!clvText.includes("row.sportKey || 'NON_DETERMINATO'"));
 check('Endpoint coverage main',server.includes("app.get('/api/clv/coverage'"));
 check('Health Tennis coverage',tennisServer.includes("'/clv-cross-sport-coverage-health'"));
 const publicIndex=fs.readFileSync(path.join(projectRoot,'public','index.html'),'utf8');
 const backendIndex=fs.readFileSync(path.join(projectRoot,'backend','public','index.html'),'utf8');
 check('Frontend index mirror',publicIndex===backendIndex);
 check('Frontend current revision future-compatible Patch53',publicIndex.includes('app.js?v=patch53-clv-cross-sport-coverage')||/app\.js\?v=patch(?:5[4-9]|[6-9]\d)-/.test(publicIndex));
 check('Script npm Patch53',Boolean(pkg.scripts?.['migrate:tennis:patch53']&&pkg.scripts?.['verify:tennis:patch53']&&pkg.scripts?.['audit:tennis:patch53']&&pkg.scripts?.['rollback:tennis:patch53']));
 console.log(JSON.stringify({success:true,patch:'TENNIS_PATCH_53_CLV_COVERAGE_CROSS_SPORT_SPORT_KEY_RESOLUTION',revision:'R1_WINDOWS_NODE_CLV_COVERAGE_CROSS_SPORT_ROUTING',checks:details.length,errors:details.filter(x=>!x.ok&&x.severity==='error').length,warnings:details.filter(x=>!x.ok&&x.severity==='warning').length,details},null,2));
}catch(error){console.log(JSON.stringify({success:false,patch:'TENNIS_PATCH_53_CLV_COVERAGE_CROSS_SPORT_SPORT_KEY_RESOLUTION',error:error.stack||error.message,checks:details.length,errors:details.filter(x=>!x.ok&&x.severity==='error').length,warnings:details.filter(x=>!x.ok&&x.severity==='warning').length,details},null,2));process.exit(1);}
