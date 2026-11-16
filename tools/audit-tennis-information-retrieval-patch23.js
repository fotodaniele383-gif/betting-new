#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const retrieval = require('../backend/tennisInformationRetrievalCertification');

function openDb(dbPath) {
  try {
    const Database = require('better-sqlite3');
    return { db: new Database(dbPath, { readonly: true, fileMustExist: true }), adapter: 'better-sqlite3' };
  } catch (_) {
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(dbPath, { readOnly: true }), adapter: 'node:sqlite' };
  }
}
function closeDb(db) { try { db.close(); } catch (_) {} }
function md(report) {
  const ai = report.channels?.aiAnalysis?.checks?.find(item => item.sourceId === 'AI_PLAYER_DATA_LOCAL');
  const odds = report.channels?.paperTrading?.checks?.find(item => item.sourceId === 'PAPER_ODDS_API_SCORES');
  return `# Patch 23 Information Retrieval audit\n\n- Status: **${report.status}**\n- Score: **${report.overallScore}**\n- Probe players: ${report.probePlayers.join(', ') || 'N/D'}\n- Scope: **${report.probeScope?.targetScope || 'UNRESOLVED'}**\n- Tour: **${report.probeScope?.tourScope || 'N/D'}**\n- Freshness: **${ai?.details?.status || 'N/D'}** (${ai?.details?.dataAgeDays ?? 'N/D'} giorni)\n- Aggregate ignored: **${ai?.details?.aggregateStatusIgnored === true}**\n- Source freshness not masked: **${report.sourceFreshnessNotMasked === true}**\n- Zero-key health aligned: **${report.zeroKeyHealthScoringAligned === true}**\n- Odds API: **${odds?.status || 'N/D'}**, excluded=${odds?.scoreExcluded === true}\n- Production authority: **false**\n`;
}
function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const dbPath = path.join(root, 'backend', 'database_betting.db');
  const { db, adapter } = openDb(dbPath);
  try {
    const report = retrieval.buildInformationRetrievalHealth(db, {
      dataDir: path.join(root, 'backend', 'sackmann_data'),
      historicalDatasetPath: path.join(root, 'data', 'tennisdb_historical_player_stats.json'),
      cacheDir: path.join(root, 'backend', 'cache_news')
    });
    const ai = report.channels?.aiAnalysis?.checks?.find(item => item.sourceId === 'AI_PLAYER_DATA_LOCAL');
    const odds = report.channels?.paperTrading?.checks?.find(item => item.sourceId === 'PAPER_ODDS_API_SCORES');
    const noKey = ![process.env.ODDS_API_KEY, process.env.THE_ODDS_API_KEY, process.env.ODDS_API_KEYS].some(value => value && String(value).trim());
    const success = report.version === 'TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23'
      && report.sourceFreshnessNotMasked === true
      && report.probeScope?.aggregateStatusIgnored === true
      && ai?.details?.aggregateStatusIgnored === true
      && report.zeroKeyHealthScoringAligned === true
      && (!noKey || (odds?.status === 'OPTIONAL_NOT_CONFIGURED' && odds?.scoreExcluded === true && odds?.healthWeight === 0))
      && report.probabilityWeightsChanged === false
      && report.deepScanDecisionChanged === false
      && report.qualityGateAuthority === false
      && report.stakeAuthority === false;
    const output = { ...report, success, auditAdapter: adapter, patch: '23', auditChecks: {
      version: report.version === 'TENNIS_INFORMATION_RETRIEVAL_V3_PATCH23',
      targetScopeResolved: Boolean(report.probeScope?.targetScope),
      aggregateStatusIgnored: report.probeScope?.aggregateStatusIgnored === true,
      sourceFreshnessNotMasked: report.sourceFreshnessNotMasked === true,
      zeroKeyHealthScoringAligned: report.zeroKeyHealthScoringAligned === true,
      optionalApiNeutralWhenAbsent: !noKey || (odds?.status === 'OPTIONAL_NOT_CONFIGURED' && odds?.scoreExcluded === true && odds?.healthWeight === 0),
      noOperationalAuthority: report.probabilityWeightsChanged === false && report.deepScanDecisionChanged === false && report.qualityGateAuthority === false && report.stakeAuthority === false
    }};
    const dir = path.join(root, 'audit_patch23'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'patch23_information_retrieval_audit.json'), JSON.stringify(output, null, 2));
    fs.writeFileSync(path.join(dir, 'patch23_information_retrieval_audit.md'), md(output));
    console.log(JSON.stringify(output, null, 2));
    if (!success) process.exitCode = 2;
  } finally { closeDb(db); }
}
main();
