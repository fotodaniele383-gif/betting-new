'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const refresh=require(path.join(root,'backend/tennisPlayerDataRefresh'));
const health=refresh.getPlayerDataHealth({dataDir:path.join(root,'backend/sackmann_data'),initialize:true});
const report={
  success:health.success,
  patch:'20',
  version:refresh.TENNIS_PLAYER_DATA_REFRESH_VERSION,
  requestPolicyVersion:refresh.TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
  status:health.status,
  refreshState:health.refreshState,
  degradedUsingLastKnownGood:health.degradedUsingLastKnownGood,
  latestMatchAt:health.latestMatchAt,
  dataAgeDays:health.dataAgeDays,
  lastRefreshAt:health.lastRefreshAt,
  lastRefreshAttemptAt:health.lastRefreshAttemptAt,
  lastFailure:health.lastFailure,
  localSources:(health.localSources||[]).map(x=>({sourceId:x.sourceId,exists:x.exists,validRows:x.validRows||0,latestMatchAt:x.latestMatchAt||null})),
  retryDelaysMs:health.retryDelaysMs,
  authority:{probability:false,deepScan:false,qualityGate:false,stake:false,settlement:false},
  generatedAt:new Date().toISOString()
};
const out=path.join(root,'audit_patch20');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'patch20_player_data_refresh_audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.success)process.exit(2);
