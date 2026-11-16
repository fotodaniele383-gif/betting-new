'use strict';
const path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const m=require(path.join(root,'backend','calcioRegistryInventoryHarmonizationPatch54'));
const evt={sport:'CALCIO',from:'DISABLED',to:'SCHEDULED',reasonCode:'SCHEDULER_EXPLICITLY_ENABLED'};
const disabled=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:false},state:{sport:'CALCIO',state:'DISABLED',configEnabled:false},events:[]});
const enabled=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:true},state:{sport:'CALCIO',state:'SCHEDULED',configEnabled:true,reasonCode:'RUN_COMPLETED_SUCCESSFULLY'},events:[evt]});
const running=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:true},state:{sport:'CALCIO',state:'RUNNING',configEnabled:true,reasonCode:'AUTOMATION_CORE_RUNNING'},events:[evt]});
const missingEvidence=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:true},state:{sport:'CALCIO',state:'SCHEDULED',configEnabled:true},events:[]});
const disabledMismatch=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:false},state:{sport:'CALCIO',state:'SCHEDULED',configEnabled:true},events:[evt]});
const enabledDisabledState=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:true},state:{sport:'CALCIO',state:'DISABLED',configEnabled:true},events:[evt]});
const wrongSport=m.evaluateCalcioSchedulerCompatibility({cron:{enabled:true},state:{sport:'TENNIS',state:'SCHEDULED',configEnabled:true},events:[evt]});
const checks=[
{name:'version',ok:m.SCHEDULER_COMPATIBILITY_VERSION==='AUDIT16D_R2_R1_PATCH54_SCHEDULER_COMPATIBILITY_V1'},
{name:'disabled coherent accepted',ok:disabled.compatible===true&&disabled.reason==='CALCIO_DISABLED_COHERENT'},
{name:'explicit enabled scheduled accepted',ok:enabled.compatible===true&&enabled.explicitEnableEvidence===true},
{name:'explicit enabled running accepted',ok:running.compatible===true},
{name:'enabled without explicit evidence fail closed',ok:missingEvidence.compatible===false&&missingEvidence.reason==='CALCIO_ENABLED_WITHOUT_EXPLICIT_ENABLE_EVIDENCE'},
{name:'disabled config / enabled state rejected',ok:disabledMismatch.compatible===false},
{name:'enabled config / disabled state rejected',ok:enabledDisabledState.compatible===false},
{name:'wrong sport rejected',ok:wrongSport.compatible===false},
{name:'Patch54 has no activation authority',ok:enabled.autoActivatedByPatch54===false}
];
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'AUDIT16D_R2_R1',checks:checks.length,results:checks},null,2));process.exit(failed.length?1:0);
