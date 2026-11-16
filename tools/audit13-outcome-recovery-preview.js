#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(process.argv.includes('--root') ? (process.argv[process.argv.indexOf('--root') + 1] || '.') : process.argv[2] || path.join(__dirname, '..'));
const dbPath = path.join(root, 'backend', 'database_betting.db');
const audit13 = require(path.join(root, 'backend', 'certifiedTradingOutcomeSearchAudit13'));
const official = require(path.join(root, 'backend', 'tennisOfficialSettlementResolver'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = sha(dbPath);
const db = new DatabaseSync(dbPath, { readOnly: true });
let output;
try {
  const calcio = db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='CALCIO' ORDER BY id").all();
  const tennis = db.prepare("SELECT * FROM ai_forward_test WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='TENNIS' ORDER BY id").all();
  const c = { pending: calcio.length, recentProviderEligible: 0, archiveEligible: 0, localArchiveResolvable: 0, unknownTime: 0, byLeague: {}, samples: [] };
  for (const row of calcio) {
    const plan = audit13.buildSearchPlan(row, 'CALCIO');
    if (plan.recentProviderEligible) c.recentProviderEligible++;
    if (!plan.eventTimeKnown) c.unknownTime++;
    if (plan.archiveRecoveryRequired) {
      c.archiveEligible++;
      const code = audit13.getFootballDataLeagueCode(row) || 'UNMAPPED';
      c.byLeague[code] = c.byLeague[code] || { archiveEligible: 0, resolvable: 0 };
      c.byLeague[code].archiveEligible++;
      const resolution = audit13.resolveFootballFromLocalArchive(row);
      if (resolution) {
        c.localArchiveResolvable++;
        c.byLeague[code].resolvable++;
        if (c.samples.length < 20) c.samples.push({ id: row.id, league: row.league, match: `${row.home_team} - ${row.away_team}`, matchDate: row.match_date, score: `${resolution.homeGoals}-${resolution.awayGoals}`, source: resolution.source, evidenceHash: resolution.evidenceHash });
      }
    }
  }
  const t = { pending: tennis.length, recentProviderEligible: 0, archiveEligible: 0, officialMapped: 0, unknownTime: 0, byTournament: {}, samples: [] };
  for (const row of tennis) {
    const plan = audit13.buildSearchPlan(row, 'TENNIS');
    if (plan.recentProviderEligible) t.recentProviderEligible++;
    if (!plan.eventTimeKnown) t.unknownTime++;
    if (plan.archiveRecoveryRequired) {
      t.archiveEligible++;
      const provider = official.getOfficialProviderMetadata(row);
      const key = provider?.tournamentId || row.tournament_catalog_id || row.canonical_tournament_key || 'UNMAPPED';
      t.byTournament[key] = (t.byTournament[key] || 0) + 1;
      if (provider) {
        t.officialMapped++;
        if (t.samples.length < 20) t.samples.push({ id: row.id, match: `${row.home_team} - ${row.away_team}`, matchDate: row.match_date, tournamentId: provider.tournamentId, tour: provider.tour, officialUrl: provider.url });
      }
    }
  }
  output = {
    success: true,
    patch: 'AUDIT13',
    version: audit13.VERSION,
    readOnly: true,
    providerWindowDays: audit13.RECENT_PROVIDER_WINDOW_DAYS,
    calcio: c,
    tennis: t,
    authority: { databaseMutation: false, settlementMutation: false, probabilityMutation: false, stakeMutation: false, automaticProductionActivation: false }
  };
} finally { db.close(); }
const after = sha(dbPath);
output.database = { before, after, unchanged: before === after };
output.success = output.success && before === after;
console.log(JSON.stringify(output, null, 2));
process.exit(output.success ? 0 : 1);
