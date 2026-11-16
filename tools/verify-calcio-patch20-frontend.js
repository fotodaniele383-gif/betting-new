'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public/app.js'));
const mirror = fs.readFileSync(path.join(root, 'backend/public/app.js'));
const appText = app.toString('utf8');
const serverText = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const requiredApp = [
  'calcio_stake_caution_mode',
  'CERTIFICATA · STAKE CON CAP',
  'Stake prudenziale:',
  'DECISIONE CERTIFICATA',
  'Valore economico separato'
];
const requiredServer = [
  'PATCH20_CERTIFIED_DECISION_WITH_PRUDENTIAL_CAPS',
  'BET_ALLOWED_PATCH20_PRUDENTIAL_CAP',
  'PATCH20_CERTIFIED_CAPPED_STAKE_AUTHORIZED',
  'prudentialCap'
];
const missingApp = requiredApp.filter(marker => !appText.includes(marker));
const missingServer = requiredServer.filter(marker => !serverText.includes(marker));
if (!app.equals(mirror)) throw new Error('Mirror public/app.js e backend/public/app.js non allineati');
if (missingApp.length || missingServer.length) throw new Error(`Marker mancanti: app=${missingApp.join(',')} server=${missingServer.join(',')}`);
console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_20_CERTIFIED_DECISION_STAKE_AUTHORITY_RESTORE',
  mirrorsAligned: true,
  bytes: app.length,
  sha256: crypto.createHash('sha256').update(app).digest('hex'),
  appMarkers: requiredApp,
  serverMarkers: requiredServer
}, null, 2));
