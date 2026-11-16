'use strict';
const path=require('path');
const multi=require('../backend/tennisMultiProviderData');
(async()=>{
  const root=path.resolve(__dirname,'..');
  const report=await multi.probeProviders({dataDir:path.join(root,'backend/sackmann_data'),projectRoot:root,timeoutMs:Number(process.env.TENNIS_PLAYER_DATA_PROBE_TIMEOUT_MS||30000),force:process.argv.includes('--force')});
  console.log(JSON.stringify(report,null,2));
  process.exit(report.success?0:2);
})().catch(error=>{console.error(JSON.stringify({success:false,error:error.message,patch21:error.patch21||null},null,2));process.exit(2);});
