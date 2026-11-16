'use strict';

const TENNIS_PENDING_EVENT_REVISION_VERSION = 'TENNIS_PENDING_EVENT_REVISION_SAFETY_V1_PATCH28';

function text(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return text(value).toUpperCase(); }
function isoEpoch(value) {
  if (!value) return null;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const m = text(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [,d,mo,y,h='12',mi='00',se='00'] = m;
  return Date.UTC(Number(y), Number(mo)-1, Number(d), Number(h), Number(mi), Number(se));
}
function isTennis(row = {}) {
  const all = upper([row.sport_type,row.bet_type,row.strategy_tag,row.league,row.tour_type].join(' '));
  return all.includes('TENNIS') || all.includes('ATP') || all.includes('WTA');
}
function marketFamily(row = {}) {
  const market = upper(row.market_type || row.marketType || row.bet_market || row.bet_type);
  const prediction = upper(row.prediction);
  if (market.includes('TOTAL') || prediction.includes('OVER') || prediction.includes('UNDER')) return 'TOTALS';
  if (market.includes('MONEY') || ['1','2','P1','P2','HOME','AWAY'].includes(prediction)) return 'MONEYLINE';
  return market || 'UNKNOWN';
}
function sameProviderEvent(a = {}, b = {}) {
  const providerA=text(a.provider_event_id || a.providerEventId);
  const providerB=text(b.provider_event_id || b.providerEventId);
  if (!providerA || !providerB || providerA !== providerB) return false;
  const fpA=text(a.tennis_event_fingerprint || a.tennisEventFingerprint);
  const fpB=text(b.tennis_event_fingerprint || b.tennisEventFingerprint);
  if (fpA && fpB && fpA !== fpB) return false;
  return marketFamily(a) === marketFamily(b);
}
function findActivePendingRevision(db, incoming = {}, options = {}) {
  if (!isTennis(incoming) && upper(options.sport || 'TENNIS') !== 'TENNIS') return null;
  const provider=text(incoming.provider_event_id || incoming.providerEventId);
  if (!provider) return null;
  const rows=db.prepare(`SELECT * FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING' AND COALESCE(paper_result_active,1)=1
      AND provider_event_id=?
      AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')
    ORDER BY id DESC`).all(provider).filter(row=>sameProviderEvent(incoming,row));
  if (!rows.length) return null;
  return rows.sort((a,b)=>(isoEpoch(b.canonical_match_datetime || b.match_date)||0)-(isoEpoch(a.canonical_match_datetime || a.match_date)||0) || Number(b.id)-Number(a.id))[0];
}
function reconcileActivePendingRevisions(db, options = {}) {
  const now=options.now || new Date().toISOString();
  const rows=db.prepare(`SELECT * FROM ai_forward_test
    WHERE UPPER(COALESCE(status,''))='PENDING' AND COALESCE(paper_result_active,1)=1
      AND provider_event_id IS NOT NULL AND TRIM(provider_event_id)<>''
      AND (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%')
    ORDER BY id`).all();
  const groups=new Map();
  for (const row of rows) {
    const key=`${text(row.provider_event_id)}|${text(row.tennis_event_fingerprint)}|${marketFamily(row)}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const report={version:TENNIS_PENDING_EVENT_REVISION_VERSION,scanned:rows.length,groups:groups.size,duplicateGroups:0,deactivated:0,details:[]};
  const tx=db.transaction(()=>{
    for (const [key,group] of groups) {
      if (group.length<2) continue;
      const ranked=[...group].sort((a,b)=>(isoEpoch(b.canonical_match_datetime || b.match_date)||0)-(isoEpoch(a.canonical_match_datetime || a.match_date)||0) || Number(b.id)-Number(a.id));
      const survivor=ranked[0];
      report.duplicateGroups++;
      const superseded=[];
      for (const old of ranked.slice(1)) {
        db.prepare(`UPDATE ai_forward_test SET
          paper_result_active=0,
          paper_result_duplicate_of=?,
          paper_result_dedup_reason='RESCHEDULE_SUPERSEDED_PENDING_EVENT',
          paper_result_dedup_at=?,
          stake=0,
          quality_stake_amount=0,
          trading_scope='AUDIT_ONLY',
          paper_trading_scope='AUDIT_ONLY',
          portfolio_scope='EXCLUDED_RESCHEDULE_SUPERSEDED',
          audit_scope_reason='Evento rinviato o riprogrammato: revisione PENDING precedente esclusa, storico preservato.',
          prediction_visibility='AUDIT_RESCHEDULE_SUPERSEDED'
          WHERE id=? AND COALESCE(paper_result_active,1)=1`).run(Number(survivor.id),now,Number(old.id));
        superseded.push(Number(old.id)); report.deactivated++;
      }
      report.details.push({key,survivorId:Number(survivor.id),supersededIds:superseded,providerEventId:survivor.provider_event_id,marketFamily:marketFamily(survivor)});
    }
  });
  tx();
  return report;
}

module.exports={
  TENNIS_PENDING_EVENT_REVISION_VERSION,
  marketFamily,
  sameProviderEvent,
  findActivePendingRevision,
  reconcileActivePendingRevisions
};
