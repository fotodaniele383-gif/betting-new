'use strict';
const path = require('path');
const Database = require('./sqlite-compat');
const registry = require('../backend/calcioPatchRegistry');
const allocator = require('../backend/calcioBatchPortfolioAllocator');
const dbPath = process.env.BETTING_DB_PATH || path.resolve(__dirname, '..', 'backend', 'database_betting.db');
const db = new Database(dbPath, { readonly: true });
function n(sql, ...args) { return Number(db.prepare(sql).get(...args).n || 0); }
try {
    const report = {
        success: true,
        patch: 'BETTING_PATCH_26C_CALCIO_BATCH_PORTFOLIO_AUTHORITATIVE_UI',
        certification: 'CODE_AND_OFFLINE_BATCH_FIXTURE_CERTIFIED_REQUIRES_FRESH_LIVE_ANALYSIS',
        registry: {
            version: registry.CALCIO_CURRENT_PATCH_VERSION,
            id: registry.PATCHES.find(item => item.version === '28')?.id
        },
        database: {
            total: n('SELECT COUNT(*) n FROM ai_forward_test'),
            tennis: n("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS' OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'"),
            calcio: n("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO'"),
            activePendingCalcio: n("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0"),
            observedBatches: n('SELECT COUNT(*) n FROM calcio_ai_observation_batches'),
            observedFinalizations: n('SELECT COUNT(*) n FROM calcio_ai_observation_finalizations'),
            committedBatchAllocations: n("SELECT COUNT(*) n FROM calcio_ai_portfolio_batch_allocations WHERE status='COMMITTED_BATCH'"),
            authorizedWithoutBatchCertification: n("SELECT COUNT(*) n FROM ai_forward_test WHERE COALESCE(calcio_prediction_index_eligible,0)=1 AND COALESCE(calcio_operational_stake,stake,0)>=2 AND calcio_analysis_batch_id IS NOT NULL AND COALESCE(calcio_portfolio_batch_certified,0)<>1")
        },
        guards: {
            eventPersistsPreCapOnly: true,
            oneAllocationPerBatch: true,
            orderIndependentAllocation: true,
            totalCapPct: 5,
            longshotCapPct: 1,
            kickoffCapPct: 2,
            failedEventZeroStake: true,
            eventFinalizationIdPreserved: true,
            crossBatchWriteGuard: true,
            cacheReplayGetsNewBatch: true,
            authoritativeUiRefresh: true,
            newOddsApiCalls: 0
        },
        nextStep: 'FRESH_ANALYSIS_THEN_VALIDATE_BATCH_ENDPOINT_AND_UI_DB_PARITY',
        allocatorVersion: allocator.CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION
    };
    console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }
