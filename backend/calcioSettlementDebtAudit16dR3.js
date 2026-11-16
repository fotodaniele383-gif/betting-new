'use strict';

const VERSION = 'AUDIT16D_R3_CALCIO_SETTLEMENT_DEBT_AUDIT_V1';

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildReport(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const staleHours = Math.max(1, Number(options.staleHours || process.env.AUDIT16D_R3_STALE_PENDING_HOURS || 24));
  const cutoffMs = now.getTime() - staleHours * 60 * 60 * 1000;
  const rows = db.prepare(`
    SELECT id, home_team, away_team, match_date, status, stake, prediction,
           settlement_source, settlement_evidence_hash, settlement_source_event_id,
           data_quality
    FROM ai_forward_test
    WHERE UPPER(COALESCE(sport_type,''))='CALCIO'
      AND UPPER(COALESCE(status,''))='PENDING'
    ORDER BY id ASC
  `).all();
  const stale = rows.map(row => ({ ...row, parsed: parseDate(row.match_date) }))
    .filter(row => row.parsed && row.parsed.getTime() < cutoffMs)
    .map(row => ({
      id: row.id,
      match: `${row.home_team || 'N/D'} - ${row.away_team || 'N/D'}`,
      matchDate: row.parsed.toISOString(),
      ageHours: Math.round(((now.getTime() - row.parsed.getTime()) / 3600000) * 10) / 10,
      stake: Number(row.stake || 0),
      prediction: row.prediction || null,
      dataQuality: row.data_quality || null,
      settlementEvidencePresent: Boolean(row.settlement_source && row.settlement_evidence_hash && row.settlement_source_event_id)
    }));
  return {
    success: true,
    readOnly: true,
    version: VERSION,
    generatedAt: now.toISOString(),
    staleHours,
    pendingCalcio: rows.length,
    stalePending: stale.length,
    realStakeStalePending: stale.filter(r => r.stake > 0).length,
    evidencePresent: stale.filter(r => r.settlementEvidencePresent).length,
    action: stale.length ? 'RECOVERY_QUEUE_REVIEW_REQUIRED' : 'NO_STALE_PENDING_DEBT',
    mutation: false,
    sample: stale.slice(0, 25)
  };
}

module.exports = { VERSION, buildReport };
