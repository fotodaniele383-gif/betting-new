'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const publicAppPath = path.join(root, 'public/app.js');
const backendAppPath = path.join(root, 'backend/public/app.js');
const publicHtmlPath = path.join(root, 'public/index.html');
const backendHtmlPath = path.join(root, 'backend/public/index.html');
const serverPath = path.join(root, 'backend/server.js');
const registryPath = path.join(root, 'backend/calcioPatchRegistry.js');

const publicApp = fs.readFileSync(publicAppPath);
const backendApp = fs.readFileSync(backendAppPath);
const publicHtml = fs.readFileSync(publicHtmlPath);
const backendHtml = fs.readFileSync(backendHtmlPath);
const appText = publicApp.toString('utf8');
const serverText = fs.readFileSync(serverPath, 'utf8');
const registryText = fs.readFileSync(registryPath, 'utf8');

assert(publicApp.equals(backendApp), 'Frontend app mirrors differ');
assert(publicHtml.equals(backendHtml), 'Frontend HTML mirrors differ');

const appMarkers = [
  'calcioOddsCertificationFromBet',
  'renderCalcioCertifiedOddsCell',
  'CERTIFICATA MULTI-FONTE',
  '1 FONTE · SOLO ANALISI',
  'NON CERTIFICATA',
  'Fonte:',
  'calcio_odds_certification_status',
  'calcio_odds_bookmaker_title',
  'calcio_odds_last_update',
  'calcio_odds_source_count'
];
for (const marker of appMarkers) assert(appText.includes(marker), `Missing frontend marker: ${marker}`);

const serverMarkers = [
  "require('./calcioCertifiedOddsProvenance')",
  'marketConsensus.analysisOdds',
  'calcio_odds_provenance_version',
  'calcio_odds_certification_status',
  'calcio_odds_operational_eligible',
  'calcio_odds_bookmaker_title',
  'calcio_odds_last_update',
  'UNIFIED_PREDICTION_INDEX_WITH_CERTIFIED_ODDS_GUARD'
];
for (const marker of serverMarkers) assert(serverText.includes(marker), `Missing server marker: ${marker}`);

assert(!serverText.includes('let odds = { ...marketConsensus.executionOdds }'), 'Server still consumes legacy/derived executionOdds');
assert(registryText.includes('BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE'));
assert(registryText.includes('newOddsApiCalls: 0'));
assert(registryText.includes('minimumIndependentOddsSources: 2'));

console.log(JSON.stringify({
  success: true,
  patch: 'BETTING_PATCH_18_CERTIFIED_ODDS_PROVENANCE_MULTI_SOURCE',
  frontendMirrorsAligned: true,
  appBytes: publicApp.length,
  htmlBytes: publicHtml.length,
  appMarkers: appMarkers.length,
  serverMarkers: serverMarkers.length,
  safeguards: {
    legacyExecutionOddsNotConsumedByServer: true,
    bookmakerVisible: true,
    timestampVisible: true,
    certificationVisible: true
  }
}, null, 2));
