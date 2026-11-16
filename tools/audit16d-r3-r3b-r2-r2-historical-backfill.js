'use strict';
const path = require('path');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
async function main() {
  const root = path.resolve(arg('--root', process.cwd()));
  const mod = require(path.join(root, 'backend', 'calcioSerieBHistoricalCalibrationAudit16dR3R3bR2R2.js'));
  const max = Number(arg('--max-new-stats', '72'));
  const result = await mod.backfillHistorical({ projectRoot: root, maxNewStatsPerRun: Number.isFinite(max) ? max : 72 });
  console.log(JSON.stringify(result, null, 2));
  if (result.success === false) process.exitCode = 2;
}
main().catch(err => { console.error(JSON.stringify({success:false,error:String(err?.stack || err)},null,2)); process.exitCode=1; });
