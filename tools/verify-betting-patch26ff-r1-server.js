'use strict';
const fs=require('fs');const path=require('path');const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'backend/server.js'),'utf8');const tennisServer=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');const audit=fs.readFileSync(path.join(root,'backend/tennisProgramProgressionAudit.js'),'utf8');
const checks=[
{name:'endpoint runtime diagnostics preservato',ok:server.includes('/api/runtime-diagnostics')},
{name:'endpoint progression preservato',ok:tennisServer.includes('/program-progression-health')},
{name:'pattern globale revision-aware',ok:audit.includes('/^betting-patch[a-z0-9-]+$/i')},
{name:'scope patch globale corrente richiesto',ok:audit.includes("currentGlobalPatch.scope.includes('public/app.js')")&&audit.includes("currentGlobalPatch.scope.includes('public/index.html')")},
{name:'marker Tennis R3 obbligatorio',ok:audit.includes("TENNIS_PATCH28_R3_RUNTIME_DIAGNOSTICS_SCOPE_ODDS_TIMEOUT_DERIVED_STATE_ALIGNMENT")}
];const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
