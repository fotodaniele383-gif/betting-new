'use strict';
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const provider = require(path.join(root,'backend','calcioFootballDataProvider.js'));
provider.refreshAll({forceRefresh:true}).then(result=>{
  console.log(JSON.stringify(result,null,2));
  process.exit(result.success || result.partial ? 0 : 2);
}).catch(error=>{ console.error(JSON.stringify({success:false,error:error.message,diagnostics:error.diagnostics||null},null,2)); process.exit(2); });
