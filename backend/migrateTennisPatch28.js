'use strict';
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const cohorts = require('./tennisForwardCohorts');
const revisions = require('./tennisPendingEventRevisionSafety');

const dbPath = path.resolve(process.argv[2] || path.join(__dirname, 'database_betting.db'));
const db = new DatabaseSync(dbPath);
db.transaction = fn => (...args) => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(...args); db.exec('COMMIT'); return value; } catch (error) { try { db.exec('ROLLBACK'); } catch (_) {} throw error; } };
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function immutableCohortMap() {
  const rows = db.prepare(`SELECT bet_id,cohort_id,cohort_version,cohort_role,holdout_locked,snapshot_id,snapshot_hash,captured_at,match_start_at,event_fingerprint,market_fingerprint,sealed_at,seal_hash FROM tennis_forward_cohort_members ORDER BY bet_id`).all();
  return hash(rows);
}
function counts() {
  return {
    total:Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n||0),
    tennis:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%'").get().n||0),
    resolved:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE (UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(league,'')) LIKE '%ATP%' OR UPPER(COALESCE(league,'')) LIKE '%WTA%') AND UPPER(COALESCE(status,'')) IN ('WON','LOST','VOID','PUSH')").get().n||0),
    pending:Number(db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' AND UPPER(COALESCE(status,''))='PENDING' AND COALESCE(paper_result_active,1)=1").get().n||0)
  };
}
function evidenceSummary() {
  const rows=db.prepare(`SELECT UPPER(COALESCE(settlement_contract_status,'PENDING')) status,COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' AND UPPER(COALESCE(status,''))='PENDING' AND COALESCE(paper_result_active,1)=1 GROUP BY 1`).all();
  const out={pendingEvidence:0,proposedWeakEvidence:0,sourceConflict:0,contractInvalid:0,manualReview:0};
  for (const r of rows) {
    const n=Number(r.n||0);
    if (r.status==='PROPOSED') out.proposedWeakEvidence+=n;
    else if (r.status==='CONFLICT') out.sourceConflict+=n;
    else if (r.status==='REJECTED') out.contractInvalid+=n;
    else if (r.status==='MANUAL_REVIEW') out.manualReview+=n;
    else if (!['VERIFIED','VOID'].includes(r.status)) out.pendingEvidence+=n;
  }
  return out;
}
try {
  const before=counts();
  const immutableBefore=immutableCohortMap();
  const now=new Date().toISOString();
  const revisionReport=revisions.reconcileActivePendingRevisions(db,{now});
  const cohortReport=cohorts.reconcileForwardCohortMaturity(db,{evaluatedAt:now,operationId:`PATCH28_MIGRATION_${Date.now()}`});
  const after=counts();
  const immutableAfter=immutableCohortMap();
  const proposedQuarantined=Number(db.prepare(`SELECT COUNT(*) n FROM ai_forward_test a JOIN tennis_forward_cohort_members c ON c.bet_id=a.id WHERE UPPER(COALESCE(a.settlement_contract_status,''))='PROPOSED' AND c.maturity_status='QUARANTINED' AND COALESCE(a.paper_result_active,1)=1`).get().n||0);
  const activeDuplicateGroups=Number(db.prepare(`SELECT COUNT(*) n FROM (SELECT provider_event_id,COALESCE(tennis_event_fingerprint,''),UPPER(COALESCE(market_type,'')),COUNT(*) c FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' AND UPPER(COALESCE(status,''))='PENDING' AND COALESCE(paper_result_active,1)=1 AND provider_event_id IS NOT NULL GROUP BY 1,2,3 HAVING c>1)`).get().n||0);
  const success=before.total===after.total && before.tennis===after.tennis && before.resolved===after.resolved && immutableBefore===immutableAfter && proposedQuarantined===0 && activeDuplicateGroups===0;
  console.log(JSON.stringify({success,patch:'TENNIS_PATCH_28',migration:'DERIVED_COHORT_STATE_AND_PENDING_RESCHEDULE_DEDUP_ONLY',before,after,pendingRevisionReconciliation:revisionReport,cohortReconciliation:cohortReport,immutableCohortFieldsChanged:immutableBefore===immutableAfter?0:1,proposedQuarantined,activeDuplicateGroups,evidenceStatus:evidenceSummary(),historicalRowsRewritten:0},null,2));
  process.exit(success?0:1);
} catch (error) {
  console.log(JSON.stringify({success:false,patch:'TENNIS_PATCH_28',error:error.message,stack:error.stack},null,2)); process.exit(1);
} finally { db.close(); }
