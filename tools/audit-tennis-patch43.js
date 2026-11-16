#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const i=process.argv.indexOf('--root');const root=path.resolve(i>=0&&process.argv[i+1]?process.argv[i+1]:'.');
const pkg=require(path.join(root,'package.json'));delete require.cache[require.resolve(path.join(root,'backend','tennisPatchRegistry.js'))];const reg=require(path.join(root,'backend','tennisPatchRegistry.js'));const mod=require(path.join(root,'backend','tennisWtaSourceDiscoveryPatch43.js'));
const checks=[];const add=(name,ok,details={})=>checks.push({name,ok:Boolean(ok),details});
add('versioni Patch43',pkg.version==='21.30.0'&&String(reg.TENNIS_CURRENT_PATCH_VERSION)==='43',{packageVersion:pkg.version,registry:reg.TENNIS_CURRENT_PATCH_VERSION});
add('policy dinamica',mod.POLICY_VERSION==='TENNIS_WTA_SOURCE_POLICY_V1_PATCH43');
const h=mod.health({dataDir:path.join(root,'backend','sackmann_data'),projectRoot:root});
add('quattro sorgenti registrate',h.registry.length===4,{sources:h.registry.map(x=>x.id)});
add('no scraping e no bot bypass',h.noScraping===true&&h.noBotBypass===true);
add('attivazione atomica e LKG',h.atomicActivation===true&&h.lastKnownGoodPreserved===true);
add('guard licenza',mod.sourceRegistry(2026,{usageMode:'COMMERCIAL'}).filter(x=>x.network).every(x=>x.enabled===false));
add('import locale esplicito',h.manualImportAuthorized===false&&h.manualImportPaths.every(x=>x.includes('tennisdata-app')));
add('autorità production assente',h.probabilityAuthority===false&&h.stakeAuthority===false);
add('server sintatticamente valido',(()=>{try{require('child_process').execFileSync(process.execPath,['--check',path.join(root,'backend','server.tennis.js')]);return true}catch(_){return false}})());
add('database non migrato',!fs.existsSync(path.join(root,'backend','migrateTennisPatch43.js')));
const errors=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:errors.length===0,patch:'TENNIS_PATCH_43_WTA_SOURCE_DISCOVERY_MIRROR_MANUAL_IMPORT_ATOMIC_RECOVERY',checks:checks.length,errors:errors.length,details:checks},null,2));if(errors.length)process.exit(1);
