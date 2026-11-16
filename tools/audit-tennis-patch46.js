#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const cp=require('child_process');const {DatabaseSync}=require('node:sqlite');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');const checks=[];
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function add(name,ok,details=null,severity='error'){checks.push({name,ok:Boolean(ok),severity,details});}
try{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 const registryPath=path.join(root,'backend','tennisPatchRegistry.js');delete require.cache[require.resolve(registryPath)];const registry=require(registryPath);
 const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend','tennis_patch_inventory.json'),'utf8'));
 const modPath=path.join(root,'backend','tennisStakeExecutionContractPatch46.js');delete require.cache[require.resolve(modPath)];const mod=require(modPath);
 const server=fs.readFileSync(path.join(root,'backend','server.tennis.js'),'utf8');const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
 add('Package Patch46 compatibile',/^21\.(3[3-9]|[4-9][0-9])\./.test(pkg.version)||pkg.version==='21.33.0',{actual:pkg.version});
 add('Registry Patch46 o successivo',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=46,{current:registry.TENNIS_CURRENT_PATCH_VERSION,registryVersion:registry.TENNIS_PATCH_REGISTRY_VERSION});
 add('Voce Patch45 preservata',registry.PATCHES.some(x=>x.version==='45'&&/CLV contract runtime binding/i.test(x.title)));
 add('Voce Patch46 registrata',registry.PATCHES.some(x=>x.version==='46'&&/Stake authority semantic separation/i.test(x.title)));
 add('Inventory Patch46 o successivo',Number(inventory.registry?.currentPatchVersion)>=46,inventory.registry);
 const health=mod.health();
 add('Unica autorità finale',health.singleFinalAuthority===true&&health.finalAuthority===mod.FINAL_AUTHORITY,health);
 add('TPI diagnostico senza autorità',health.tpiAuthority===mod.TPI_AUTHORITY&&health.tpiAuthority.includes('NO_STAKE_AUTHORITY'));
 add('Nessun aumento stake',health.noStakeIncrease===true);
 add('Logiche quantitative invariate',health.probabilityChanged===false&&health.qualityLogicChanged===false&&health.riskLogicChanged===false&&health.calibrationLogicChanged===false);
 add('Server integra contract',server.includes('patch46StakeExecutionContract = tennisStakeExecutionContractPatch46.buildContract')&&server.includes('tennisStakeExecutionContractPatch46.persistSnapshot'));
 add('API e audit allineati',(server.match(/finalExecutableStakeContract: patch46StakeExecutionContract/g)||[]).length>=2);
 add('Frontend semanticamente separato',app.includes('TPI: SOLO DIAGNOSTICO')&&app.includes('Proposta modello')&&app.includes('Risk Authority')&&app.includes('Calibration Guard')&&app.includes('PATCH46_FINAL_EXECUTABLE_STAKE_CONTRACT'));
 add('Frontend mirror',sha(path.join(root,'public','app.js'))===sha(path.join(root,'backend','public','app.js'))&&sha(path.join(root,'public','index.html'))===sha(path.join(root,'backend','public','index.html')));
 add('Script npm Patch46 presenti',['preview:tennis:patch46','migrate:tennis:patch46','test:tennis:patch46','verify:tennis:patch46','audit:tennis:patch46','rollback:tennis:patch46'].every(k=>Boolean(pkg.scripts?.[k])));
 const syntaxFiles=['backend/tennisStakeExecutionContractPatch46.js','backend/migrateTennisPatch46.js','backend/server.tennis.js','public/app.js'];
 const syntaxErrors=[];for(const rel of syntaxFiles){const run=cp.spawnSync(process.execPath,['--check',path.join(root,rel)],{encoding:'utf8'});if(run.status!==0)syntaxErrors.push({file:rel,error:run.stderr});}
 add('Sintassi moduli Patch46',syntaxErrors.length===0,syntaxErrors);
 const dbPath=path.join(root,'backend','database_betting.db');const db=new DatabaseSync(dbPath,{readOnly:true,open:true});
 try{
  const integrity=Object.values(db.prepare('PRAGMA integrity_check').get())[0];const fk=db.prepare('PRAGMA foreign_key_check').all();
  add('Database integro',String(integrity).toLowerCase()==='ok'&&fk.length===0,{integrity,foreignKeyViolations:fk.length});
  const columns=new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name));const required=['tennis_stake_contract_version','tennis_stake_model_suggested','tennis_stake_quality_authority_status','tennis_stake_risk_authority_status','tennis_stake_calibration_status','tennis_stake_final_execution_status','tennis_stake_final_executable','tennis_stake_final_authority','tennis_stake_contract_hash','tennis_stake_contract_snapshot_id'];
  add('Schema semantico completo',required.every(c=>columns.has(c)),{missing:required.filter(c=>!columns.has(c))});
  const table=Boolean(db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(mod.SNAPSHOT_TABLE));add('Tabella snapshot presente',table,{table:mod.SNAPSHOT_TABLE});
  const triggers=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name").all(mod.SNAPSHOT_TABLE).map(r=>r.name);add('Snapshot append-only',triggers.some(n=>n.includes('no_update'))&&triggers.some(n=>n.includes('no_delete')),{triggers});
  const where=`(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')`;
  const pending=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${where}`).get().n);
  const covered=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${where} AND tennis_stake_contract_version=? AND tennis_stake_final_authority=?`).get(mod.VERSION,mod.FINAL_AUTHORITY).n);
  add('Copertura pending Tennis completa',covered===pending,{pending,covered});
  const mismatches=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${where} AND ABS(COALESCE(stake,0)-COALESCE(tennis_stake_final_executable,0))>0.000001`).get().n);add('Stake persistito allineato al finale',mismatches===0,{mismatches});
  const overCaps=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${where} AND (COALESCE(tennis_stake_final_executable,0)>COALESCE(tennis_stake_model_suggested,0)+0.000001 OR COALESCE(tennis_stake_final_executable,0)>COALESCE(tennis_stake_quality_cap,0)+0.000001 OR COALESCE(tennis_stake_final_executable,0)>COALESCE(tennis_stake_risk_cap,0)+0.000001 OR COALESCE(tennis_stake_final_executable,0)>COALESCE(tennis_stake_calibration_cap,0)+0.000001)`).get().n);add('Nessuna violazione cap',overCaps===0,{overCaps});
  const tpiViolations=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(status,''))='PENDING' AND ${where} AND COALESCE(tennis_stake_tpi_authority_status,'')<>?`).get(mod.TPI_AUTHORITY).n);add('TPI status coerente',tpiViolations===0,{tpiViolations});
  const snapshotRows=table?Number(db.prepare(`SELECT COUNT(*) n FROM ${mod.SNAPSHOT_TABLE}`).get().n):0;add('Snapshot coprono i contratti',snapshotRows>=covered,{snapshotRows,covered});
 }finally{db.close();}
 const failed=checks.filter(x=>!x.ok&&x.severity==='error');const warnings=checks.filter(x=>!x.ok&&x.severity==='warn');
 console.log(JSON.stringify({success:failed.length===0,patch:'TENNIS_PATCH_46_STAKE_AUTHORITY_SEMANTIC_SEPARATION_FINAL_EXECUTABLE_CONTRACT',revision:'R1_WINDOWS_NODE_FINAL_EXECUTABLE_STAKE_CONTRACT_APPEND_ONLY_SNAPSHOT',checks:checks.length,errors:failed.length,warnings:warnings.length,details:checks},null,2));if(failed.length)process.exit(1);
}catch(error){console.log(JSON.stringify({success:false,patch:'46',error:error.stack||error.message,details:checks},null,2));process.exit(1);}
