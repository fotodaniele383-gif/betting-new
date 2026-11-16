'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const a = fs.readFileSync(path.join(root, 'public', 'app.js'));
const b = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'));
assert(a.equals(b), 'Frontend mirror non byte-identico');
const text = a.toString('utf8');
[
 'portfolioDsGateMeasurementPanel', 'Stake e resa per Deep Scan IA × Qualità/Gate',
 'Prob. reale PT', 'Edge medio', 'EV medio', 'Stake teorico medio', 'Stake operativo totale', 'Profitto', 'ROI'
].forEach(marker => assert(text.includes(marker), `Marker frontend mancante: ${marker}`));
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_15_STAKE_EXECUTION_DS_GATE_PORTFOLIO_AUDIT', mirrorBytes:a.length, markers:9 }, null, 2));
