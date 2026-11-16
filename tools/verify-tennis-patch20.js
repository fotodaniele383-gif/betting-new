'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function check(name, ok, details=null){return {name,success:Boolean(ok),details};}
const registry=require(path.join(root,'backend/tennisPatchRegistry'));
const refresh=require(path.join(root,'backend/tennisPlayerDataRefresh'));
const progression=require(path.join(root,'backend/tennisProgramProgressionAudit'));
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'backend/tennis_patch_inventory.json'),'utf8'));
const checks=[
  check('Registry Patch 20+',Number(registry.TENNIS_CURRENT_PATCH_VERSION)>=20&&registry.TENNIS_PATCH_REGISTRY_VERSION===`TENNIS_PATCH_REGISTRY_V${registry.TENNIS_CURRENT_PATCH_VERSION}`),
  check('Patch 19 preservata',registry.PATCHES.some(x=>x.version==='19'&&String(x.status).startsWith('ACTIVE'))),
  check('Refresh V2 Patch 20',refresh.TENNIS_PLAYER_DATA_REFRESH_VERSION==='TENNIS_PLAYER_DATA_REFRESH_V2_PATCH20'),
  check('Retry policy 0-1-3-8',JSON.stringify(refresh.DEFAULT_RETRY_DELAYS_MS)===JSON.stringify([0,1000,3000,8000])),
  check('Tre URL allowlist con GitHub Contents API',refresh.defaultSources(2026).every(s=>{const c=refresh.sourceUrlCandidates(s);return c.length===3&&c[1].includes('api.github.com/repos/')&&refresh.sourceTransport(c[1])==='GITHUB_CONTENTS_API';})),
  check('Endpoint source probe',server.includes("router.post('/player-data-source-probe'")),
  check('Auto refresh LKG warning',server.includes("failure.degradedUsingLastKnownGood === true ? 'WARN' : 'ERROR'")),
  check('Auto apply disabled semantics',server.includes('autoApplySettingsDisabled: true')&&!server.includes("autoApplySettings: false,\n            dbPathAbsolute")),
  check('UI Test fonti',app.includes('executeTennisPlayerDataSourceProbe')&&html.includes('id="executeTennisPlayerDataSourceProbe"')),
  check('UI Patch corrente',html.includes(`Patch 1–${registry.TENNIS_CURRENT_PATCH_VERSION}`)),
  check('Progression Guard patch corrente',new RegExp(`^TENNIS_PROGRAM_PROGRESSION_AUDIT_V\\d+_PATCH${registry.TENNIS_CURRENT_PATCH_VERSION}$`).test(progression.TENNIS_PROGRAM_PROGRESSION_AUDIT_VERSION)),
  check('Frontend app byte-identici',sha(path.join(root,'public/app.js'))===sha(path.join(root,'backend/public/app.js'))),
  check('Frontend index byte-identici',sha(path.join(root,'public/index.html'))===sha(path.join(root,'backend/public/index.html'))),
  check('Inventario Patch 20+',Number(inventory.registry.currentPatchVersion)>=20&&inventory.registry.registryVersion===`TENNIS_PATCH_REGISTRY_V${inventory.registry.currentPatchVersion}`&&inventory.summary.uniqueLegacySteps===56&&inventory.summary.unregisteredCount===0),
  check('Request policy R1',refresh.TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION==='TENNIS_PLAYER_DATA_REQUEST_POLICY_V2_PATCH20_R1'&&refresh.ALLOWED_HOSTS.has('api.github.com')),
  check('Regressione Patch 18 dinamica',fs.readFileSync(path.join(root,'backend/tests/patch18TennisStatisticalChallenger.test.js'),'utf8').includes('PATCH${registry.TENNIS_CURRENT_PATCH_VERSION}')&&!fs.readFileSync(path.join(root,'backend/tests/patch18TennisStatisticalChallenger.test.js'),'utf8').includes('6_PATCH18|7_PATCH19')),
  check('Script Patch 20',Boolean(pkg.scripts['test:tennis:patch20']&&pkg.scripts['verify:tennis:patch20']&&pkg.scripts['probe:tennis:player-data-sources']))
];
const report={success:checks.every(x=>x.success),patch:'20',checks,generatedAt:new Date().toISOString()};
console.log(JSON.stringify(report,null,2));
if(!report.success)process.exit(2);
