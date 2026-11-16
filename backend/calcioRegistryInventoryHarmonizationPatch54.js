'use strict';
const fs = require('fs');
const path = require('path');

const CALCIO_REGISTRY_INVENTORY_HARMONIZATION_VERSION = 'CALCIO_REGISTRY_INVENTORY_HARMONIZATION_V1_PATCH54';
const SCHEDULER_COMPATIBILITY_VERSION = 'AUDIT16D_R2_R1_PATCH54_SCHEDULER_COMPATIBILITY_V1';
const EXPECTED_CALCIO_REGISTRY = '38';
const MIN_PACKAGE = '21.14.0';
const MIN_TENNIS_REGISTRY = 53;
const PATCH58_ENABLED_STATES = new Set([
  'IDLE','SCHEDULED','RUNNING','RECONCILING','DEGRADED','FAILED_RETRYABLE','FAILED_TERMINAL',
  'BLOCKED_UPSTREAM_GATE','READY_FOR_CONTROLLED_CANARY_REVIEW'
]);

function parseVersion(v) {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : [0,0,0];
}
function versionAtLeast(actual, minimum) {
  const a=parseVersion(actual), b=parseVersion(minimum);
  for(let i=0;i<3;i++){ if(a[i]>b[i]) return true; if(a[i]<b[i]) return false; }
  return true;
}
function activeFrontendRevision(indexText) {
  const matches=[...String(indexText||'').matchAll(/<script\s+src=["']app\.js\?v=([^"']+)["']/gi)];
  return matches.length ? matches[matches.length-1][1] : null;
}
function readJson(file, fallback=null) { try { return JSON.parse(fs.readFileSync(file,'utf8')); } catch (_) { return fallback; } }
function readJsonl(file) {
  try {
    return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line);}catch(_){return null;}}).filter(Boolean);
  } catch (_) { return []; }
}
function evaluateCalcioSchedulerCompatibility({ cron={}, state=null, events=[] }={}) {
  const enabled = cron?.enabled === true;
  const statePresent = Boolean(state && typeof state === 'object');
  const stateSportOk = !statePresent || String(state.sport || '').toUpperCase() === 'CALCIO';
  const explicitEnableEvent = events.some(e => String(e?.sport||'').toUpperCase()==='CALCIO' && e?.to==='SCHEDULED' && e?.reasonCode==='SCHEDULER_EXPLICITLY_ENABLED');
  const explicitEnableEvidence = explicitEnableEvent || state?.reasonCode === 'SCHEDULER_EXPLICITLY_ENABLED';
  let compatible = false;
  let reason = null;
  if (!statePresent) {
    compatible = false;
    reason = 'PATCH58_CALCIO_STATE_MISSING';
  } else if (!stateSportOk) {
    compatible = false;
    reason = 'PATCH58_CALCIO_STATE_SPORT_MISMATCH';
  } else if (!enabled) {
    compatible = state.configEnabled !== true && state.state === 'DISABLED';
    reason = compatible ? 'CALCIO_DISABLED_COHERENT' : 'CALCIO_DISABLED_STATE_MISMATCH';
  } else {
    const stateEnabled = state.configEnabled === true;
    const stateAllowed = PATCH58_ENABLED_STATES.has(String(state.state||''));
    compatible = stateEnabled && stateAllowed && explicitEnableEvidence;
    if (!stateEnabled) reason = 'CALCIO_ENABLED_STATE_CONFIG_FALSE';
    else if (!stateAllowed) reason = 'CALCIO_ENABLED_STATE_INVALID';
    else if (!explicitEnableEvidence) reason = 'CALCIO_ENABLED_WITHOUT_EXPLICIT_ENABLE_EVIDENCE';
    else reason = 'CALCIO_EXPLICITLY_ENABLED_COHERENT';
  }
  return {
    version: SCHEDULER_COMPATIBILITY_VERSION,
    compatible,
    enabled,
    statePresent,
    state: state?.state || null,
    stateConfigEnabled: state?.configEnabled === true,
    stateSport: state?.sport || null,
    explicitEnableEvidence,
    explicitEnableEventCount: events.filter(e => String(e?.sport||'').toUpperCase()==='CALCIO' && e?.to==='SCHEDULED' && e?.reasonCode==='SCHEDULER_EXPLICITLY_ENABLED').length,
    reason,
    autoActivatedByPatch54: false
  };
}
function buildCalcioRegistryInventoryHealth(options={}) {
  const projectRoot=path.resolve(options.projectRoot || path.join(__dirname,'..'));
  const registry=require(path.join(projectRoot,'backend','calcioPatchRegistry.js'));
  const tennisRegistry=require(path.join(projectRoot,'backend','tennisPatchRegistry.js'));
  const inventory=JSON.parse(fs.readFileSync(path.join(projectRoot,'backend','calcio_patch_inventory.json'),'utf8'));
  const pkg=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8'));
  const cron=JSON.parse(fs.readFileSync(path.join(projectRoot,'backend','calcio_cron_config.json'),'utf8'));
  const schedulerState=readJson(path.join(projectRoot,'backend','.scheduler_patch58_runtime','calcio_scheduler_state.json'),null);
  const schedulerEvents=readJsonl(path.join(projectRoot,'backend','.scheduler_patch58_runtime','calcio_scheduler_events.jsonl'));
  const schedulerCompatibility=evaluateCalcioSchedulerCompatibility({cron,state:schedulerState,events:schedulerEvents});
  const indexPublic=fs.readFileSync(path.join(projectRoot,'public','index.html'),'utf8');
  const indexBackend=fs.readFileSync(path.join(projectRoot,'backend','public','index.html'),'utf8');
  const reg=registry.PATCHES || []; const inv=inventory.patches || [];
  const byV=new Map(inv.map(p=>[String(p.version),p]));
  const missing=reg.filter(p=>!byV.has(String(p.version))).map(p=>p.version);
  const mismatched=reg.filter(p=>{const q=byV.get(String(p.version)); return q && (q.id!==p.id || q.status!==p.status);}).map(p=>p.version);
  const extra=inv.filter(p=>!reg.some(r=>String(r.version)===String(p.version))).map(p=>p.version);
  const versions=reg.map(p=>Number(p.version)).filter(Number.isFinite).sort((a,b)=>a-b);
  const continuous=versions.length===38 && versions.every((v,i)=>v===i+1);
  const duplicateVersions=new Set(reg.map(p=>p.version)).size!==reg.length;
  const duplicateIds=new Set(reg.map(p=>p.id)).size!==reg.length;
  const frontendRevision=activeFrontendRevision(indexPublic);
  const checks=[
    {name:'CALCIO_REGISTRY_V38_CURRENT',ok:String(registry.CALCIO_CURRENT_PATCH_VERSION)===EXPECTED_CALCIO_REGISTRY && registry.CALCIO_PATCH_REGISTRY_VERSION==='CALCIO_PATCH_REGISTRY_V38'},
    {name:'INVENTORY_V38_ALIGNED',ok:inventory.schemaVersion==='CALCIO_PATCH_INVENTORY_V38_PATCH54' && String(inventory.registry?.currentPatchVersion)==='38'},
    {name:'ALL_ACTIVE_PATCHES_INVENTORIED',ok:missing.length===0 && mismatched.length===0 && extra.length===0},
    {name:'REGISTRY_CONTINUOUS_UNIQUE',ok:continuous && !duplicateVersions && !duplicateIds},
    {name:'PACKAGE_FUTURE_COMPATIBLE',ok:versionAtLeast(pkg.version,MIN_PACKAGE)},
    {name:'TENNIS_REGISTRY_FUTURE_COMPATIBLE',ok:Number(tennisRegistry.TENNIS_CURRENT_PATCH_VERSION)>=MIN_TENNIS_REGISTRY},
    {name:'FRONTEND_MIRROR_SYNC',ok:indexPublic===indexBackend},
    {name:'FRONTEND_ACTIVE_REVISION_PRESENT',ok:Boolean(frontendRevision)},
    {name:'CALCIO_SCHEDULER_PATCH58_COMPATIBLE',ok:schedulerCompatibility.compatible}
  ];
  const failed=checks.filter(c=>!c.ok);
  return {
    success:failed.length===0,status:failed.length?'ERROR':'OK',
    version:CALCIO_REGISTRY_INVENTORY_HARMONIZATION_VERSION,
    schedulerCompatibilityVersion:SCHEDULER_COMPATIBILITY_VERSION,
    packageVersion:pkg.version,calcioRegistry:String(registry.CALCIO_CURRENT_PATCH_VERSION),tennisRegistry:String(tennisRegistry.TENNIS_CURRENT_PATCH_VERSION),
    inventory:{schemaVersion:inventory.schemaVersion,count:inv.length,missing,mismatched,extra,continuous,duplicateVersions,duplicateIds},
    frontend:{activeRevision:frontendRevision,mirrorSync:indexPublic===indexBackend},
    scheduler:schedulerCompatibility,
    authority:{probabilityChanged:false,stakeChanged:false,settlementChanged:false,automaticProductionActivation:false,schedulerActivationAuthority:false},
    checks
  };
}
module.exports={CALCIO_REGISTRY_INVENTORY_HARMONIZATION_VERSION,SCHEDULER_COMPATIBILITY_VERSION,EXPECTED_CALCIO_REGISTRY,MIN_PACKAGE,MIN_TENNIS_REGISTRY,PATCH58_ENABLED_STATES,parseVersion,versionAtLeast,activeFrontendRevision,evaluateCalcioSchedulerCompatibility,buildCalcioRegistryInventoryHealth};
