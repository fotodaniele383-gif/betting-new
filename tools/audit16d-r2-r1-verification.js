'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const h=require(path.join(root,'backend','calcioRegistryInventoryHarmonizationPatch54')).buildCalcioRegistryInventoryHealth({projectRoot:root});
let temporal=null;try{const p=require(path.join(root,'backend','calcioTemporalAnalysisPolicyAudit16dR2'));temporal={version:p.VERSION||p.CALCIO_TEMPORAL_ANALYSIS_POLICY_VERSION||null,available:true};}catch(e){temporal={available:false,error:e.message};}
const report={success:h.success===true&&h.scheduler?.compatible===true&&temporal.available===true,patch:'AUDIT16D_R2_R1',readOnly:true,scheduler:h.scheduler,registry:{status:h.status,calcioRegistry:h.calcioRegistry,inventory:h.inventory},temporal,authority:h.authority};
console.log(JSON.stringify(report,null,2));process.exit(report.success?0:1);
