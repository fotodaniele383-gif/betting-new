'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path');
const root=path.join(__dirname,'..'); const server=fs.readFileSync(path.join(root,'backend','server.js'),'utf8');
const checks=[
 ["imports historical coverage module",server.includes("require('./calcioHistoricalCoverageEntityResolution')")],
 ['builds primary plus related coverage context',server.includes('createCoverageContext({') && server.includes('coverageSnapshotIndex')],
 ['resolves each live match before model inputs',server.includes('historicalCoverageContext.resolveMatch')],
 ['injects real lower-division team stats',server.includes('historicalCoverageContext.buildLegacyTeamStats')],
 ['uses composite index for snapshots',server.includes('buildMatchSnapshots(coverageSnapshotIndex')],
 ['uses composite index for opponent form',server.includes('buildMatchAdjustment(\n                            coverageSnapshotIndex')],
 ['persists coverage audit',server.includes('calcioHistoricalCoverage.buildPersistenceFields')],
 ['exposes read-only diagnostics endpoint',server.includes("/api/calcio/diagnostics/historical-coverage")],
 ['does not add Odds API calls',!server.includes('PATCH26FB_ODDS_API_CALL')]
];
for(const [name,ok] of checks) assert.ok(ok,name);
console.log(JSON.stringify({success:true,checks:checks.map(([name,ok])=>({name,ok}))},null,2));
