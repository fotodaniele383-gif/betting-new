'use strict';
const path=require('path');const fs=require('fs');const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const mod=require(path.join(root,'backend','calcioRegistryInventoryHarmonizationPatch54'));const h=mod.buildCalcioRegistryInventoryHealth({projectRoot:root});
const inv=require(path.join(root,'backend','calcio_patch_inventory.json'));const reg=require(path.join(root,'backend','calcioPatchRegistry'));
const checks=[
{name:'health success',ok:h.success===true},{name:'registry 38',ok:h.calcioRegistry==='38'},{name:'inventory V38',ok:inv.schemaVersion==='CALCIO_PATCH_INVENTORY_V38_PATCH54'},
{name:'38 patch inventariate',ok:inv.patches?.length===38&&reg.PATCHES.length===38},{name:'zero unregistered',ok:h.inventory.missing.length===0&&h.inventory.extra.length===0&&h.inventory.mismatched.length===0},
{name:'versioni 1-38 continue',ok:h.inventory.continuous===true},{name:'id/version unici',ok:!h.inventory.duplicateIds&&!h.inventory.duplicateVersions},
{name:'Patch38 analytics preservata',ok:reg.PATCHES.at(-1)?.id==='BETTING_PATCH_26F_F_CROSS_SPORT_AI_OUTCOME_PROBABILITY_BANDS'},
{name:'inventory summary coerente',ok:inv.summary?.unregisteredCount===0&&inv.summary?.registeredCount===38},{name:'nessuna hash legacy stale autoritativa',ok:Object.keys(inv.protectedFiles||{}).length===0},
{name:'scheduler Patch58 compatibility active',ok:h.schedulerCompatibilityVersion==='AUDIT16D_R2_R1_PATCH54_SCHEDULER_COMPATIBILITY_V1'},
{name:'scheduler config/state coherent',ok:h.scheduler?.compatible===true},{name:'Patch54 cannot auto-activate scheduler',ok:h.scheduler?.autoActivatedByPatch54===false},
{name:'no probability/stake/settlement authority',ok:h.authority?.probabilityChanged===false&&h.authority?.stakeChanged===false&&h.authority?.settlementChanged===false&&h.authority?.automaticProductionActivation===false}
];const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'TENNIS_PATCH_54_CALCIO_REGISTRY_INVENTORY_REGRESSION_HARMONIZATION',revision:'AUDIT16D_R2_R1',checks:checks.length,results:checks,health:h},null,2));process.exit(failed.length?1:0);
