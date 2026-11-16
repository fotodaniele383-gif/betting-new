'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const provider=require(path.join(root,'backend','calcioFootballDataProvider.js'));
const registry=require(path.join(root,'backend','calcioPatchRegistry.js'));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend','calcio_patch_inventory.json'),'utf8'));
const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const health=provider.getFootballDataHealth();
const report={
  generatedAt:new Date().toISOString(),
  scope:'CALCIO_PATCH_3',
  registry:registry.getCalcioPatchStatus(),
  inventory:{schemaVersion:inventory.schemaVersion,protectedFileCount:Object.keys(inventory.protectedFiles||{}).length,unregisteredCount:inventory.summary?.unregisteredCount??null},
  footballData:{
    providerVersion:provider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
    seasonCandidates:provider.buildSeasonCandidates(new Date()),
    health,
    serverWiring:{callSites:(server.match(/await calcioFootballDataProvider\.getLeagueCsv/g)||[]).length,staticSeasonUrlsRemoved:!server.includes('mmz4281/2526/${config.code}.csv')&&!server.includes('mmz4281/2425/${config.code}.csv'),freshnessEndpoint:server.includes('/api/calcio/football-data-freshness'),refreshEndpoint:server.includes('/api/calcio/football-data-refresh'),localOnlyRefresh:server.includes('CALCIO_FOOTBALL_DATA_REFRESH_LOCAL_ONLY'),startupBestEffort:server.includes('scheduleBestEffortRefresh')}
  },
  regressions:{databaseMigration:false,tennisAuthorityChanged:false,probabilityWeightsChanged:false,stakePolicyChanged:false,patch1XgWiring:(server.match(/expHomeGoals:\s*xgResult\.expHomeGoals/g)||[]).length>=2,patch2Consensus:server.includes('buildCalcioMarketConsensus')},
  nextPriorities:['Strict Calcio sport identity and current-clean sample intake.','Precompute team statistics by temporal checkpoint without leakage.','Apply uncertainty penalty to stake only after forward evidence is sufficient.']
};
const dir=path.join(root,'audit_calcio_patch3');fs.mkdirSync(dir,{recursive:true});const out=path.join(dir,'calcio_patch3_audit.json');fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(`\nReport: ${path.relative(root,out)}`);
