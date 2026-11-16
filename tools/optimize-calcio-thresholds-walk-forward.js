'use strict';
const path=require('path');const optimizer=require('../backend/calcioHistoricalThresholdOptimizer');
try{const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const report=optimizer.run(root);console.log(JSON.stringify(report,null,2));if(!report.success)process.exitCode=1;}catch(e){console.error('PATCH12 OPTIMIZER ERROR:',e.stack||e.message);process.exit(1);}
