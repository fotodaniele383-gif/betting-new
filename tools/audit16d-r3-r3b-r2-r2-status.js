'use strict';
const path = require('path');
function arg(name, fallback = null) { const i=process.argv.indexOf(name); return i>=0&&i+1<process.argv.length?process.argv[i+1]:fallback; }
try {
  const root=path.resolve(arg('--root',process.cwd()));
  const mod=require(path.join(root,'backend','calcioSerieBHistoricalCalibrationAudit16dR3R3bR2R2.js'));
  console.log(JSON.stringify(mod.status({projectRoot:root}),null,2));
} catch(err) { console.error(JSON.stringify({success:false,error:String(err?.stack||err)},null,2)); process.exitCode=1; }
