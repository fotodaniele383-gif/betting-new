'use strict';

const VERSION = 'AUDIT16D_R3_T11_R3_SETTLEMENT_CONTRACT_AUDIT_V1';
const EXPECTED_CONTRACT_VERSION = 'TENNIS_SETTLEMENT_CONTRACT_V2_AUDIT02';
const ACCEPTED_SETTLED_STATES = Object.freeze(['VERIFIED','VOID','MANUAL_REVIEW']);
function text(v){ return String(v == null ? '' : v).trim(); }
function inspect(db, settlementContract) {
  const moduleVersion = text(settlementContract?.TENNIS_SETTLEMENT_CONTRACT_VERSION);
  const evaluatorReady = typeof settlementContract?.evaluateTennisSettlementContract === 'function';
  const cols = new Set(db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r => r.name));
  const schemaReady = ['settlement_contract_status','settlement_contract_version','settlement_source'].every(c => cols.has(c));
  const tennisWhere = "(UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%' OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')";
  let byStatus = {}, byVersion = {}, invalidAutoSettled = null, historicalPendingSourceOnSettled = null, settled = 0, pending = 0;
  if (schemaReady) {
    byStatus = Object.fromEntries(db.prepare(`SELECT COALESCE(settlement_contract_status,'UNCLASSIFIED') k, COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} GROUP BY COALESCE(settlement_contract_status,'UNCLASSIFIED')`).all().map(r=>[r.k,r.n]));
    byVersion = Object.fromEntries(db.prepare(`SELECT COALESCE(settlement_contract_version,'UNCLASSIFIED') k, COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} GROUP BY COALESCE(settlement_contract_version,'UNCLASSIFIED')`).all().map(r=>[r.k,r.n]));
    invalidAutoSettled = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND settlement_contract_version = ? AND UPPER(COALESCE(settlement_contract_status,'')) NOT IN ('VERIFIED','VOID','MANUAL_REVIEW')`).get(moduleVersion)?.n ?? 0;
    historicalPendingSourceOnSettled = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID') AND UPPER(COALESCE(settlement_source,'')) LIKE 'PENDING%'`).get()?.n ?? 0;
    settled = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,'')) IN ('WON','LOST','PUSH','VOID')`).get()?.n ?? 0;
    pending = db.prepare(`SELECT COUNT(*) n FROM ai_forward_test WHERE ${tennisWhere} AND UPPER(COALESCE(status,''))='PENDING'`).get()?.n ?? 0;
  }
  const versionCompatible = moduleVersion === EXPECTED_CONTRACT_VERSION;
  const contractActive = evaluatorReady && versionCompatible && schemaReady;
  const reviewDebt = Number(invalidAutoSettled || 0) + Number(historicalPendingSourceOnSettled || 0);
  const status = !contractActive ? 'CONTRACT_NOT_ACTIVE' : reviewDebt > 0 ? 'ACTIVE_WITH_REVIEW_DEBT' : 'ACTIVE_CLEAN';
  return {
    success:contractActive,
    readOnly:true,
    version:VERSION,
    status,
    module:{version:moduleVersion,expectedVersion:EXPECTED_CONTRACT_VERSION,evaluatorReady,versionCompatible},
    schema:{ready:schemaReady,requiredColumns:['settlement_contract_status','settlement_contract_version','settlement_source']},
    counts:{settled,pending,byContractStatus:byStatus,byContractVersion:byVersion,invalidAutoSettled,historicalPendingSourceOnSettled,reviewDebt},
    interpretation: versionCompatible ? 'Health contract aligned to Settlement Contract V2. Remaining debt is row-level review/legacy evidence, not a module-version failure.' : 'Settlement module version does not match the current certified contract.',
    authority:{settlementMutation:false,stakeChange:false,modelChange:false,automaticRepair:false},
    generatedAt:new Date().toISOString()
  };
}
module.exports = { VERSION, EXPECTED_CONTRACT_VERSION, ACCEPTED_SETTLED_STATES, inspect };
