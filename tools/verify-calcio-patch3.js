'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
function run(relative){
  const result=cp.spawnSync(process.execPath,[path.join(root,relative),root],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
  if(result.stdout) process.stdout.write(result.stdout);
  if(result.stderr) process.stderr.write(result.stderr);
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(`${relative} failed with ${result.status}`);
}
run('tools/test-calcio-patch1-standalone.js');
run('tools/test-calcio-patch2-standalone.js');
run('tools/test-calcio-patch3-standalone.js');
const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const checks={
  providerImported:server.includes("require('./calcioFootballDataProvider')"),
  analysisAndBacktestWired:(server.match(/await calcioFootballDataProvider\.getLeagueCsv/g)||[]).length===2,
  static2526Removed:!server.includes('mmz4281/2526/${config.code}.csv'),
  static2425Removed:!server.includes('mmz4281/2425/${config.code}.csv'),
  localRefreshGuard:server.includes('CALCIO_FOOTBALL_DATA_REFRESH_LOCAL_ONLY'),
  startupBestEffort:server.includes('scheduleBestEffortRefresh'),
  patch1XgWiring:(server.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g)||[]).length>=2,
  patch2Consensus:server.includes('buildCalcioMarketConsensus')
};
const success=Object.values(checks).every(Boolean);
const report={success,patch:'CALCIO_PATCH_3',checks};
const dir=path.join(root,'audit_calcio_patch3'); fs.mkdirSync(dir,{recursive:true});
const out=path.join(dir,'calcio_patch3_verification_report.json'); fs.writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2)); console.log(`\nReport: ${path.relative(root,out)}`);
if(!success) process.exit(2);
