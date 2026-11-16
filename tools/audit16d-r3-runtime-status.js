#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':path.join(__dirname,'..'));
const dbPath=path.join(ROOT,'backend','database_betting.db');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=sha(dbPath);
const configPath=path.join(ROOT,'backend','calcio_cron_config.json');
const cfg=JSON.parse(fs.readFileSync(configPath,'utf8'));
const server=fs.readFileSync(path.join(ROOT,'backend','server.js'),'utf8');
const scheduler=fs.readFileSync(path.join(ROOT,'backend','calcioAutoScheduler.js'),'utf8');
const tennis=fs.readFileSync(path.join(ROOT,'backend','server.tennis.js'),'utf8');
const understat=fs.readFileSync(path.join(ROOT,'backend','calcioUnderstatProviderV2.js'),'utf8');
let db=null;let clv={},settlement={};
try{
  db=new DatabaseSync(dbPath,{readOnly:true});
  const scalar=(sql,...args)=>db.prepare(sql).get(...args)?.n??0;
  clv={
    missingNoSnapshot:scalar("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(clv_last_attempt_result,''))='CLV_VAULT_NO_SNAPSHOT'"),
    cooldownActive:scalar("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(clv_last_attempt_result,'')) IN ('CLV_VAULT_NO_SNAPSHOT','CLV_VAULT_NO_CLOSING_ODD_FOR_PICK') AND COALESCE(clv_next_retry_ts,0)>?",Date.now()),
    verified:scalar("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(clv_verified,0)=1")
  };
  const rows=db.prepare("SELECT id,home_team,away_team,match_date,stake FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,''))='PENDING'").all();
  const cutoff=Date.now()-24*3600000;
  const stale=rows.filter(r=>{const t=Date.parse(r.match_date);return Number.isFinite(t)&&t<cutoff});
  settlement={pendingCalcio:rows.length,stalePending24h:stale.length,realStakeStale:stale.filter(r=>Number(r.stake||0)>0).length,sample:stale.slice(0,10)};
} finally {if(db)db.close();}
const cacheDir=path.join(ROOT,'backend','data','calcio_understat_v2');
const lkgFiles=fs.existsSync(cacheDir)?fs.readdirSync(cacheDir).filter(x=>x.endsWith('.json')):[];
const after=sha(dbPath);
const out={
  success:before===after,
  patch:'AUDIT16D_R3',
  readOnly:true,
  scheduler:{
    enabled:cfg.enabled===true,
    type:cfg.type,
    intervalHours:cfg.intervalHours,
    intervalAnchorAt:cfg.intervalAnchorAt||null,
    nextRunAt:cfg.nextRunAt||null,
    schedulerMode:cfg.schedulerMode||null,
    exactIntervalSource:scheduler.includes('AUDIT16D_R3_CALCIO_EXACT_INTERVAL_AND_CLV_CENTRALIZATION_V1'),
    duplicateClvCronRemoved:!scheduler.includes("cron.schedule('*/15 * * * *'"),
    clvAuthority:'SERVER_STEP103_STEP104_GLOBAL_TRACKER',
    migrationPendingUntilRestart:cfg.type==='interval_hours'&&cfg.schedulerMode!=='PERSISTENT_EXACT_INTERVAL'
  },
  orchestration:{
    coordinatorPresent:server.includes("require('./runtimeWorkloadCoordinatorAudit16dR3')"),
    analyzeGuardBound:server.includes("runtimeWorkloadCoordinatorAudit16dR3.calcioAnalysisMiddleware"),
    manualClvGuardBound:server.includes("beginClv({ source: 'MANUAL_ENDPOINT'"),
    autoClvGuardBound:server.includes('beginClv({ source: `AUTO_${source}`')
  },
  clv,
  tennis:{
    refreshAlreadyRunningIsSkip:tennis.includes('PLAYER_DATA_REFRESH_SKIPPED_LOCK_ACTIVE')&&tennis.includes("level: lockConflict ? 'INFO'")
  },
  understat:{
    recoveryVersionPresent:understat.includes('AUDIT16D_R3_UNDERSTAT_SESSION_JSON_RESILIENCE_V1'),
    sessionRecoveryPresent:understat.includes('recoverUnderstatSeasonWithSession'),
    tolerantJsonPresent:understat.includes('parseUnderstatAjaxText'),
    lkgFileCount:lkgFiles.length,
    lkgFiles
  },
  settlementDebt:settlement,
  database:{before,after,unchanged:before===after}
};
console.log(JSON.stringify(out,null,2));
process.exit(out.success?0:1);
