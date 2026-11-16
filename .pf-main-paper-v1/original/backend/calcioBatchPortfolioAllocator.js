'use strict';

const crypto = require('crypto');
const path = require('path');
const calcioDeepScanFinalState = require('./calcioDeepScanFinalState');
const calcioFinalMarketDiagnosticContract = require('./calcioFinalMarketDiagnosticContract');
const unifiedCrossSportPortfolioRiskAuthorityPatch56 = require('./unifiedCrossSportPortfolioRiskAuthorityPatch56');

const CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION = 'BETTING_PATCH_26F_A_BATCH_PORTFOLIO_ALLOCATOR_V6';
const MINIMUM_OPERATIONAL_STAKE = 2;

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
    return String(value ?? '').trim();
}

function parseJson(value, fallback = {}) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}

function json(value) {
    return JSON.stringify(value ?? null);
}

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function digest(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function eventKeyOf(row = {}) {
    return text(row.match_exposure_key || row.calcio_event_key || row.event_key || row.eventKey)
        || [text(row.home_team || row.home), text(row.away_team || row.away), text(row.match_date || row.date || row.commence_time)].join('|');
}

function columnNames(db, table) {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
}

function ensureColumn(db, table, name, definition) {
    const columns = columnNames(db, table);
    if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function runTransaction(db, fn) {
    if (typeof db.transaction === 'function') return db.transaction(fn)();
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw error;
    }
}

function ensureSchema(db) {
    unifiedCrossSportPortfolioRiskAuthorityPatch56.ensureSchema(db);
    db.exec(`
        CREATE TABLE IF NOT EXISTS calcio_ai_portfolio_batch_allocations (
            allocation_id TEXT PRIMARY KEY,
            version TEXT NOT NULL,
            batch_id TEXT NOT NULL,
            finalization_digest TEXT NOT NULL,
            bankroll_snapshot REAL,
            status TEXT NOT NULL,
            expected_event_count INTEGER,
            terminal_event_count INTEGER,
            completed_event_count INTEGER,
            failed_event_count INTEGER,
            eligible_event_count INTEGER,
            total_pre_cap_stake REAL,
            total_post_cap_stake REAL,
            caps_json TEXT,
            event_keys_json TEXT,
            row_snapshot_json TEXT,
            created_at TEXT NOT NULL,
            diagnostics_json TEXT,
            UNIQUE(batch_id, finalization_digest)
        );
        CREATE INDEX IF NOT EXISTS idx_calcio_portfolio_batch_allocations_batch
            ON calcio_ai_portfolio_batch_allocations(batch_id, created_at DESC);
    `);

    const additions = {
        calcio_analysis_batch_id: 'TEXT',
        calcio_event_finalization_id: 'TEXT',
        calcio_portfolio_allocation_id: 'TEXT',
        calcio_portfolio_batch_status: 'TEXT',
        calcio_portfolio_batch_certified: 'INTEGER DEFAULT 0',
        calcio_portfolio_pre_cap_eligible: 'INTEGER DEFAULT 0',
        calcio_portfolio_pre_cap_stake: 'REAL DEFAULT 0',
        calcio_portfolio_post_cap_stake: 'REAL DEFAULT 0',
        calcio_portfolio_cap_reason: 'TEXT',
        calcio_batch_output_coherence_status: 'TEXT',
        calcio_deepscan_final_state_version: 'TEXT',
        calcio_deepscan_final_state_action: 'TEXT',
        calcio_deepscan_final_state_score: 'REAL',
        calcio_deepscan_final_state_audit: 'TEXT',
        calcio_deepscan_final_report_json: 'TEXT',
        calcio_cross_market_reliability_version: 'TEXT',
        calcio_cross_market_stress_status: 'TEXT',
        calcio_cross_market_stress_probability: 'REAL',
        calcio_cross_market_gap_pp: 'REAL',
        calcio_cross_market_lambda_home: 'REAL',
        calcio_cross_market_lambda_away: 'REAL',
        calcio_analysis_maturity_score: 'REAL',
        calcio_days_to_kickoff: 'REAL',
        calcio_epistemic_uncertainty_score: 'REAL',
        calcio_robust_probability: 'REAL',
        calcio_robust_ev_pct: 'REAL',
        calcio_reliability_stake_multiplier: 'REAL',
        calcio_unadjusted_pre_cap_stake: 'REAL',
        calcio_reliability_adjusted_stake: 'REAL',
        calcio_reliability_guard_status: 'TEXT',
        calcio_reliability_guard_audit: 'TEXT',
        calcio_stake_authority_version: 'TEXT',
        calcio_stake_authority_status: 'TEXT',
        calcio_stake_authority_model_stake: 'REAL',
        calcio_stake_authority_reliability_stake: 'REAL',
        calcio_stake_authority_pre_cap_stake: 'REAL',
        calcio_stake_authority_final_stake: 'REAL',
        calcio_stake_probability_pct: 'REAL',
        calcio_stake_full_kelly_pct: 'REAL',
        calcio_stake_fractional_kelly: 'REAL',
        calcio_stake_event_cap_pct: 'REAL',
        calcio_stake_minimum_eur: 'REAL',
        calcio_stake_bankroll_snapshot: 'REAL',
        calcio_stake_bankroll_source: 'TEXT',
        calcio_stake_authority_reason: 'TEXT',
        calcio_stake_authority_audit: 'TEXT',
        calcio_data_quality_authority_version: 'TEXT',
        calcio_data_quality_score: 'REAL',
        calcio_data_quality_status: 'TEXT',
        calcio_data_quality_label: 'TEXT',
        calcio_data_quality_blocking: 'INTEGER',
        calcio_data_quality_reasons: 'TEXT',
        calcio_data_quality_audit: 'TEXT',
        calcio_bankroll_snapshot_consistent: 'INTEGER',
        calcio_final_narrative_version: 'TEXT',
        calcio_final_narrative: 'TEXT',
        calcio_final_market_contract_version: 'TEXT',
        calcio_final_market_id: 'TEXT',
        calcio_final_market_snapshot: 'TEXT',
        calcio_forecast_confidence_score: 'REAL',
        calcio_forecast_confidence_label: 'TEXT',
        calcio_decision_state_version: 'TEXT',
        calcio_decision_state: 'TEXT',
        calcio_decision_state_reason: 'TEXT',
        calcio_diagnostic_coherence_status: 'TEXT',
        calcio_diagnostic_coherence_audit: 'TEXT'
    };
    for (const [name, definition] of Object.entries(additions)) {
        ensureColumn(db, 'ai_forward_test', name, definition);
    }
    db.exec(`
        CREATE TABLE IF NOT EXISTS calcio_stake_authority_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            authority_version TEXT NOT NULL,
            batch_id TEXT,
            event_key TEXT,
            bet_id INTEGER,
            bankroll_snapshot REAL,
            model_stake REAL,
            reliability_stake REAL,
            final_stake REAL,
            robust_ev_pct REAL,
            data_quality_status TEXT,
            status TEXT NOT NULL,
            reason TEXT,
            audit_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calcio_stake_authority_batch ON calcio_stake_authority_audit_log(batch_id, created_at);
        CREATE TABLE IF NOT EXISTS calcio_final_market_contract_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contract_version TEXT NOT NULL,
            batch_id TEXT,
            event_key TEXT,
            bet_id INTEGER,
            market_id TEXT,
            prediction TEXT,
            market_type TEXT,
            decision_state TEXT,
            coherence_status TEXT,
            snapshot_json TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_calcio_final_market_contract_batch
            ON calcio_final_market_contract_audit_log(batch_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_calcio_final_market_contract_market
            ON calcio_final_market_contract_audit_log(market_id, created_at);
    `);
    return additions;
}

function getBatch(db, batchId) {
    return db.prepare(`SELECT * FROM calcio_ai_observation_batches WHERE batch_id = ?`).get(batchId) || null;
}

function getBatchEvents(db, batchId) {
    return db.prepare(`
        SELECT batch_id, event_key, bet_id, prediction, created_at
        FROM calcio_ai_observation_batch_events
        WHERE batch_id = ?
        ORDER BY created_at, event_key
    `).all(batchId);
}

function getLatestFinalizations(db, batchId) {
    const rows = db.prepare(`
        SELECT * FROM calcio_ai_observation_finalizations
        WHERE batch_id = ?
        ORDER BY event_key, started_at DESC
    `).all(batchId);
    const map = new Map();
    for (const row of rows) {
        if (!map.has(row.event_key)) map.set(row.event_key, row);
    }
    return map;
}

function latestActiveRowForEvent(db, eventKey, preferredId = null) {
    if (preferredId) {
        const preferred = db.prepare(`
            SELECT * FROM ai_forward_test
            WHERE id = ?
              AND UPPER(COALESCE(sport_type, '')) = 'CALCIO'
              AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
              AND COALESCE(paper_result_active, 1) = 1
              AND COALESCE(paper_result_conflict, 0) = 0
        `).get(preferredId);
        if (preferred && eventKeyOf(preferred) === eventKey) return preferred;
    }
    return db.prepare(`
        SELECT * FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
          AND COALESCE(paper_result_active, 1) = 1
          AND COALESCE(paper_result_conflict, 0) = 0
          AND (match_exposure_key = ? OR calcio_event_key = ?)
        ORDER BY id DESC LIMIT 1
    `).get(eventKey, eventKey) || null;
}

function latestActiveRows(db) {
    const rows = db.prepare(`
        SELECT * FROM ai_forward_test
        WHERE UPPER(COALESCE(sport_type, '')) = 'CALCIO'
          AND UPPER(COALESCE(status, 'PENDING')) = 'PENDING'
          AND UPPER(COALESCE(bet_type, '')) IN ('SINGLE', 'SINGLE_CR')
          AND COALESCE(paper_result_active, 1) = 1
          AND COALESCE(paper_result_conflict, 0) = 0
        ORDER BY id DESC
    `).all();
    const seen = new Set();
    return rows.filter(row => {
        const key = eventKeyOf(row);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function hydratePredictionIndex(row = {}) {
    const components = parseJson(row.calcio_prediction_index_components, {});
    const score = num(row.calcio_prediction_index_score, 0);
    const preCapStake = Math.max(0, num(
        row.calcio_stake_authority_pre_cap_stake,
        num(row.calcio_portfolio_pre_cap_stake, num(row.calcio_reliability_adjusted_stake, 0))
    ));
    const authorityAudit = parseJson(row.calcio_stake_authority_audit, {});
    const preCapEligible = authorityAudit.eligible === true
        && Number(row.calcio_portfolio_pre_cap_eligible || 0) === 1
        && preCapStake >= MINIMUM_OPERATIONAL_STAKE;
    return {
        score,
        rankValue: num(row.calcio_prediction_index_rank_value, score),
        label: text(row.calcio_prediction_index_label),
        reason: text(row.calcio_portfolio_pre_cap_reason || row.calcio_prediction_index_reason || row.calcio_stake_lifecycle_reason),
        components,
        theoreticalStake: num(row.calcio_stake_authority_model_stake, num(row.calcio_theoretical_stake, preCapStake)),
        prePortfolioCapStake: preCapStake,
        operationalStake: preCapStake,
        eligible: preCapEligible,
        allowBet: preCapEligible,
        status: preCapEligible ? 'UNIFIED_STAKE_AUTHORITY_AUTHORIZED' : 'UNIFIED_STAKE_AUTHORITY_NO_STAKE',
        action: preCapEligible ? 'BET_ALLOWED_UNIFIED_STAKE_AUTHORITY' : 'ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY',
        gateStatus: preCapEligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO',
        netExecutableOdd: num(row.calcio_net_executable_odd, num(row.odd, 0)),
        edgePp: num(row.edge_pp, num(row.edge, 0)),
        evPct: num(row.ev_pct, 0),
        dataClass: text(row.stake_confidence_level || row.calcio_data_class),
        finalizationStatus: text(row.calcio_ai_finalization_status),
        stakeAuthority: authorityAudit,
        dataQualityAssessment: parseJson(row.calcio_data_quality_audit, {}),
        decisionCertification: {
            status: text(row.calcio_decision_certification_status || row.calcio_ipm_certification_status),
            reason: text(row.calcio_decision_certification_reason || row.calcio_prediction_index_reason)
        }
    };
}

function isCompletedFinalization(finalization = {}) {
    return text(finalization.status).toUpperCase() === 'COMPLETED';
}

function isTerminalFinalization(finalization = {}) {
    return ['COMPLETED', 'FAILED'].includes(text(finalization.status).toUpperCase());
}

function rowIsDirectlyCertifiable(row = {}, finalization = {}) {
    const rankingCertified = Number(row.calcio_market_ranking_certified || 0) === 1;
    const coherence = text(row.calcio_output_coherence_status).toUpperCase();
    const eventCommitted = text(row.calcio_finalization_transaction_status).toUpperCase() === 'COMMITTED_EVENT_ONLY';
    const crossEvent = Number(finalization.cross_event_write_detected || 0) === 1;
    const degraded = num(finalization.degraded_finalized_count, 0) > 0;
    const direct = num(finalization.direct_finalized_count, 0);
    const authority = parseJson(row.calcio_stake_authority_audit, {});
    const dataQuality = parseJson(row.calcio_data_quality_audit, {});
    const bankrollConsistent = Number(row.calcio_bankroll_snapshot_consistent ?? 1) === 1;
    const authorityPreCapStake = num(row.calcio_stake_authority_pre_cap_stake, authority.prePortfolioCapStake);
    // PATCH 26E-C: qualità dati bloccante significa ANALYSIS_ONLY, non finalizzazione fallita.
    // È certificabile soltanto quando la Stake Authority ha realmente applicato il veto a €0.
    const blockingQualitySafelyVetoed = dataQuality.blocking !== true
        || (authority.eligible !== true && authorityPreCapStake < MINIMUM_OPERATIONAL_STAKE);
    return isCompletedFinalization(finalization)
        && eventCommitted
        && rankingCertified
        && coherence === 'OUTPUT_COHERENCE_CERTIFIED'
        && !crossEvent
        && !degraded
        && direct >= 2
        && Boolean(row.calcio_stake_authority_version)
        && authority.operationalAuthority === 'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY'
        && blockingQualitySafelyVetoed
        && bankrollConsistent;
}

function strategyTagFor(row = {}, eligible = false) {
    const raw = text(row.strategy_tag || 'CALCIO_SINGLE');
    const base = raw.replace(/_(OPERATIONAL|ANALYSIS_ONLY)$/i, '');
    return `${base}_${eligible ? 'OPERATIONAL' : 'ANALYSIS_ONLY'}`;
}

function stageFor(eligible, failed, reason) {
    if (failed) return {
        code: 'FAILED_FINALIZATION',
        label: 'FINALIZZAZIONE FALLITA',
        reason
    };
    if (eligible) return {
        code: 'OPERATIONAL_CANDIDATE',
        label: 'MIGLIOR PRONOSTICO CERTIFICATO',
        reason
    };
    return {
        code: 'ANALYSIS_ONLY',
        label: 'MIGLIOR MERCATO FINALIZZATO · ANALISI',
        reason
    };
}

function qualityLabelFor(row = {}, eligible = false, failed = false) {
    if (failed) return 'FINALIZZAZIONE FALLITA';
    const authority = parseJson(row.calcio_stake_authority_audit, {});
    if (eligible) return text(authority.qualityFinalLabel) || 'APPROVATA CON CAP';
    const action = text(authority.effectiveAction || row.ds_action).toUpperCase();
    if (action.includes('ALTO RISCHIO')) return 'BLOCCATA HARD';
    if (action.includes('RISCHIO MODELLO')) return 'BLOCCATA SOFT';
    return 'WATCHLIST MICRO';
}

function committedReason(row = {}, predictionIndex = {}, eligible = false, failureReason = null) {
    if (failureReason) return failureReason;
    const stake = Math.max(0, num(predictionIndex.operationalStake, 0));
    const authorityReason = text(row.calcio_stake_authority_reason || predictionIndex.stakeAuthority?.reason || predictionIndex.reason);
    return eligible
        ? `Allocazione batch completata: stake operativo €${stake.toFixed(2)}. ${authorityReason}`.trim()
        : `Allocazione batch completata senza stake operativo. ${authorityReason}`.trim();
}

function refreshFinalReportJson(row = {}, predictionIndex = {}, allocation = {}) {
    const compact = parseJson(row.calcio_deepscan_final_report_json, {});
    if (!compact || typeof compact !== 'object' || !Object.keys(compact).length) return row.calcio_deepscan_final_report_json || null;
    const operationalStake = num(allocation.operationalStake, 0);
    const odd = num(predictionIndex.netExecutableOdd, num(row.odd, 0));
    const estimatedProfit = operationalStake > 0 && odd > 1 ? operationalStake * (odd - 1) : 0;
    compact.predictionIndex = { ...(compact.predictionIndex || {}), ...predictionIndex, operationalStake, estimatedProfit };
    compact.stakeReconciliation = { ...(compact.stakeReconciliation || {}), ...predictionIndex, operationalStake, estimatedProfit };
    compact.stakeAuthority = { ...(compact.stakeAuthority || parseJson(row.calcio_stake_authority_audit, {})), finalOperationalStake: operationalStake, batchSynchronized: true };
    compact.dataQualityAuthority = { ...(compact.dataQualityAuthority || parseJson(row.calcio_data_quality_audit, {})) };
    compact.finalNarrative = allocation.finalNarrative || allocation.reason || compact.finalNarrative || null;
    if (compact.deepScanAdvisory) compact.deepScanAdvisory.rationale = compact.finalNarrative || compact.deepScanAdvisory.rationale;
    compact.stakeLifecycle = {
        ...(compact.stakeLifecycle || {}),
        theoreticalStake: num(row.calcio_theoretical_stake, predictionIndex.theoreticalStake),
        operationalStake,
        estimatedOperationalProfit: estimatedProfit,
        status: allocation.status,
        action: allocation.action,
        reason: allocation.reason,
        automaticExecution: allocation.eligible === true,
        dataClass: predictionIndex.dataClass
    };
    compact.analysisStage = allocation.analysisStage;
    compact.qualityFinalLabel = allocation.qualityFinalLabel;
    compact.operationalState = allocation.operationalState;
    compact.outputCoherence = allocation.outputCoherence;
    compact.portfolioAllocation = allocation.portfolioAllocation;
    compact.finalStateDeepScan = {
        ...(compact.finalStateDeepScan || {}),
        finalOperationalStake: operationalStake,
        finalTheoreticalStake: num(row.calcio_theoretical_stake, predictionIndex.theoreticalStake),
        batchSynchronized: true,
        synchronizedAt: nowIso()
    };
    if (allocation.finalMarketDiagnostic) {
        compact.finalMarketDiagnostic = allocation.finalMarketDiagnostic;
        compact.finalMarket = {
            ...(compact.finalMarket || {}),
            marketId: allocation.finalMarketDiagnostic.marketId,
            prediction: allocation.finalMarketDiagnostic.prediction,
            marketType: allocation.finalMarketDiagnostic.marketType,
            odd: allocation.finalMarketDiagnostic.odd,
            probability: allocation.finalMarketDiagnostic.probabilityPct,
            edgePp: allocation.finalMarketDiagnostic.edgePp,
            evPct: allocation.finalMarketDiagnostic.evPct
        };
    }
    compact.reliabilityGuard = {
        ...(compact.reliabilityGuard || parseJson(row.calcio_reliability_guard_audit, {})),
        unadjustedPreCapStake: num(row.calcio_unadjusted_pre_cap_stake, num(row.calcio_theoretical_stake, 0)),
        reliabilityAdjustedStake: num(row.calcio_reliability_adjusted_stake, num(row.calcio_portfolio_pre_cap_stake, 0)),
        finalOperationalStake: operationalStake,
        batchSynchronized: true
    };
    return json(compact);
}

function buildUpdateFields(row, predictionIndex, allocationId, batchId, finalization, failureReason = null) {
    const failed = Boolean(failureReason);
    const allowed = failed ? 0 : Math.max(0, num(predictionIndex.operationalStake, 0));
    const eligible = allowed >= MINIMUM_OPERATIONAL_STAKE && predictionIndex.eligible === true && !failed;
    const ptSample = num(predictionIndex.components?.paperTrading?.sample, 0);
    const finalReason = committedReason(row, { ...predictionIndex, operationalStake: allowed }, eligible, failureReason);
    let stage = stageFor(eligible, failed, finalReason);
    const gateStatus = eligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO';
    const lifecycleStatus = eligible ? 'UNIFIED_STAKE_AUTHORITY_AUTHORIZED' : 'UNIFIED_STAKE_AUTHORITY_NO_STAKE';
    const lifecycleAction = eligible ? 'BET_ALLOWED_UNIFIED_STAKE_AUTHORITY' : 'ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY';
    const certification = failed
        ? 'DECISION_NOT_CERTIFIED_FAILED_FINALIZATION'
        : (eligible
            ? (ptSample > 0 ? 'STRUCTURALLY_CERTIFIED_PT_VALIDATED' : 'STRUCTURALLY_CERTIFIED_PT_ABSENT')
            : 'DECISION_ANALYSIS_ONLY');
    const certificationLabel = failed
        ? 'FINALIZZAZIONE FALLITA · NESSUNA AUTORITÀ STAKE'
        : (eligible
            ? (ptSample > 0 ? 'STRUTTURALMENTE CERTIFICATA · PT VALIDATO' : 'STRUTTURALMENTE CERTIFICATA · PT ASSENTE')
            : 'ANALISI · NESSUNA AUTORITÀ STAKE');
    const operationalState = {
        analysisOnly: !eligible,
        calcio_analysis_only: eligible ? 0 : 1,
        prediction_visibility: eligible ? 'OPERATIONAL_CANDIDATE' : 'ANALYSIS_ONLY',
        exposure_role: eligible ? 'PRIMARY_OPERATIONAL' : 'ANALYSIS_ONLY',
        strategy_tag: strategyTagFor(row, eligible),
        certificationLabel,
        ptCertificationStatus: ptSample > 0 ? 'PT_VALIDATED' : 'PT_ABSENT_NEUTRAL'
    };
    const outputCoherence = {
        status: failed ? 'BATCH_OUTPUT_COHERENCE_NOT_CERTIFIED' : 'BATCH_OUTPUT_COHERENCE_CERTIFIED',
        certified: !failed
    };
    const portfolioAllocation = {
        allocationId: failed ? null : allocationId,
        eventFinalizationId: finalization?.finalization_id || null,
        batchId,
        batchCertified: !failed,
        preCapStake: num(row.calcio_portfolio_pre_cap_stake, 0),
        postCapStake: allowed,
        capReason: predictionIndex.portfolioCapReason || failureReason || null
    };
    const finalQualityLabel = qualityLabelFor(row, eligible, failed);
    const existingFinalMarketDiagnostic = parseJson(row.calcio_final_market_snapshot, {});
    const fallbackComponents = parseJson(row.calcio_prediction_index_components, {});
    const baseFinalMarketDiagnostic = Object.keys(existingFinalMarketDiagnostic).length
        ? existingFinalMarketDiagnostic
        : calcioFinalMarketDiagnosticContract.buildFinalMarketSnapshot({
            candidate: row,
            eventKey: eventKeyOf(row),
            prediction: row.prediction,
            marketType: row.market_type,
            odd: row.odd,
            probabilityPct: row.estimated_prob,
            edgePp: row.edge_pp ?? row.edge,
            evPct: row.ev_pct,
            probabilityIntegrity: {},
            probabilityFallback: {
                modelProbabilityPct: fallbackComponents.probability?.model,
                monteCarloProbabilityPct: fallbackComponents.probability?.monteCarlo,
                marketProbabilityPct: fallbackComponents.probability?.marketProbability,
                disagreementPp: fallbackComponents.probability?.marketGapPp,
                monteCarloSamplingErrorPp: fallbackComponents.probability?.monteCarloStdErrorPp
            },
            predictionReliability: {
                score: row.calcio_prediction_reliability_score,
                label: row.calcio_prediction_reliability_label
            },
            dataQuality: parseJson(row.calcio_data_quality_audit, {
                status: row.calcio_data_quality_status,
                label: row.calcio_data_quality_label,
                score: row.calcio_data_quality_score,
                blocking: num(row.calcio_data_quality_blocking, 0) === 1
            }),
            stakeAuthority: parseJson(row.calcio_stake_authority_audit, {
                modelStake: row.calcio_stake_authority_model_stake,
                reliabilityStake: row.calcio_stake_authority_reliability_stake,
                prePortfolioCapStake: row.calcio_stake_authority_pre_cap_stake,
                robustEvPct: row.calcio_robust_ev_pct,
                robustProbabilityPct: row.calcio_robust_probability,
                epistemicUncertaintyScore: row.calcio_epistemic_uncertainty_score
            }),
            decision: predictionIndex,
            finalOperationalStake: 0,
            eligible: false,
            allowBet: false,
            finalizationStatus: row.calcio_ai_finalization_status,
            finalizationCertified: !failed,
            reason: finalReason
        });
    const finalMarketDiagnostic = calcioFinalMarketDiagnosticContract.refreshAfterAllocation(baseFinalMarketDiagnostic, {
        finalOperationalStake: allowed,
        eligible,
        allowBet: eligible,
        failed,
        failureReason,
        reason: finalReason,
        finalizationStatus: failed ? 'FAILED_FINALIZATION' : (predictionIndex.finalizationStatus || row.calcio_ai_finalization_status),
        finalizationCertified: !failed,
        dataClass: predictionIndex.dataClass,
        authorityStatus: eligible ? 'STAKE_AUTHORITY_AUTHORIZED' : 'STAKE_AUTHORITY_NO_STAKE',
        dataQuality: {
            status: row.calcio_data_quality_status || baseFinalMarketDiagnostic.dataQuality?.status,
            label: row.calcio_data_quality_label || baseFinalMarketDiagnostic.dataQuality?.label,
            score: num(row.calcio_data_quality_score, baseFinalMarketDiagnostic.dataQuality?.score),
            blocking: num(row.calcio_data_quality_blocking, baseFinalMarketDiagnostic.dataQuality?.blocking ? 1 : 0) === 1
        }
    });
    calcioFinalMarketDiagnosticContract.assertSnapshotCoherence(finalMarketDiagnostic, { throwOnError: true });
    stage = calcioFinalMarketDiagnosticContract.analysisStageFromDecisionState(finalMarketDiagnostic.decisionState);
    const finalReportJson = refreshFinalReportJson(row, predictionIndex, {
        operationalStake: allowed,
        estimatedProfit: allowed * Math.max(0, num(predictionIndex.netExecutableOdd, num(row.odd, 0)) - 1),
        eligible,
        status: lifecycleStatus,
        action: lifecycleAction,
        reason: finalReason,
        analysisStage: stage,
        qualityFinalLabel: finalQualityLabel,
        finalNarrative: finalReason,
        operationalState,
        outputCoherence,
        portfolioAllocation,
        finalMarketDiagnostic
    });
    return {
        ...calcioFinalMarketDiagnosticContract.persistenceFields(finalMarketDiagnostic),
        stake: allowed,
        calcio_operational_stake: allowed,
        calcio_stake_authority_final_stake: allowed,
        calcio_stake_authority_status: eligible ? 'STAKE_AUTHORITY_AUTHORIZED' : 'STAKE_AUTHORITY_NO_STAKE',
        calcio_stake_authority_reason: finalReason,
        calcio_final_narrative: finalReason,
        calcio_final_narrative_version: 'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1',
        calcio_portfolio_post_cap_stake: allowed,
        calcio_portfolio_cap_reason: predictionIndex.portfolioCapReason || failureReason || null,
        calcio_gate_max_stake: allowed,
        calcio_gate_allow_bet: eligible ? 1 : 0,
        calcio_prediction_index_eligible: eligible ? 1 : 0,
        calcio_stake_lifecycle_status: lifecycleStatus,
        calcio_stake_lifecycle_reason: finalReason,
        calcio_operational_status: gateStatus,
        calcio_operational_action: lifecycleAction,
        calcio_operational_summary: finalReason,
        calcio_gate_status: gateStatus,
        calcio_gate_reasons: finalReason,
        calcio_prediction_index_reason: finalReason,
        calcio_decision_certification_status: certification,
        calcio_decision_certification_reason: finalReason,
        calcio_analysis_stage_code: stage.code,
        calcio_analysis_stage_label: stage.label,
        calcio_analysis_stage_reason: stage.reason,
        calcio_quality_final_label: finalQualityLabel,
        quality_final_label: finalQualityLabel,
        quality_final_reason: finalReason,
        quality_stake_mode: eligible ? 'UNIFIED_STAKE_AUTHORITY' : 'UNIFIED_STAKE_AUTHORITY_NO_STAKE',
        quality_stake_amount: allowed,
        calcio_analysis_only: eligible ? 0 : 1,
        prediction_visibility: eligible ? 'OPERATIONAL_CANDIDATE' : 'ANALYSIS_ONLY',
        exposure_role: eligible ? 'PRIMARY_OPERATIONAL' : 'ANALYSIS_ONLY',
        strategy_tag: strategyTagFor(row, eligible),
        calcio_pt_certification_status: ptSample > 0 ? 'PT_VALIDATED' : 'PT_ABSENT_NEUTRAL',
        calcio_structural_certification_label: certificationLabel,
        calcio_portfolio_cap_post_finalization: failed ? 0 : 1,
        calcio_analysis_batch_id: batchId,
        calcio_event_finalization_id: finalization?.finalization_id || null,
        calcio_portfolio_allocation_id: failed ? null : allocationId,
        calcio_portfolio_batch_status: failed ? 'EXCLUDED_FAILED_FINALIZATION' : 'COMMITTED_BATCH',
        calcio_portfolio_batch_certified: failed ? 0 : 1,
        calcio_ai_finalization_status: failed
            ? 'FAILED_FINALIZATION'
            : (predictionIndex.finalizationStatus || row.calcio_ai_finalization_status || 'MARKET_RANKING_FULLY_FINALIZED'),
        calcio_output_coherence_status: failed ? 'OUTPUT_COHERENCE_NOT_CERTIFIED' : 'OUTPUT_COHERENCE_CERTIFIED',
        calcio_runtime_consistency_status: failed
            ? 'FAILED_FINALIZATION_NO_STAKE'
            : (eligible ? 'BATCH_PORTFOLIO_STAKE_CERTIFIED' : 'BATCH_PORTFOLIO_ANALYSIS_CERTIFIED'),
        calcio_profit_display_mode: 'POTENTIAL_UNTIL_SETTLED',
        calcio_batch_output_coherence_status: failed
            ? 'BATCH_OUTPUT_COHERENCE_NOT_CERTIFIED'
            : 'BATCH_OUTPUT_COHERENCE_CERTIFIED',
        calcio_deepscan_final_report_json: finalReportJson
    };
}

function snapshotRow(row = {}) {
    const predictionIndex = hydratePredictionIndex(row);
    predictionIndex.operationalStake = num(row.calcio_operational_stake ?? row.stake, 0);
    predictionIndex.eligible = Number(row.calcio_prediction_index_eligible || 0) === 1 && predictionIndex.operationalStake >= MINIMUM_OPERATIONAL_STAKE;
    predictionIndex.allowBet = predictionIndex.eligible;
    predictionIndex.status = predictionIndex.eligible ? 'UNIFIED_STAKE_AUTHORITY_AUTHORIZED' : 'UNIFIED_STAKE_AUTHORITY_NO_STAKE';
    predictionIndex.action = predictionIndex.eligible ? 'BET_ALLOWED_UNIFIED_STAKE_AUTHORITY' : 'ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY';
    predictionIndex.gateStatus = text(row.calcio_gate_status) || (predictionIndex.eligible ? 'CALCIO_APPROVED_WITH_CAP' : 'CALCIO_WATCHLIST_MICRO');
    predictionIndex.reason = text(row.calcio_prediction_index_reason || row.calcio_stake_lifecycle_reason);
    predictionIndex.estimatedProfit = predictionIndex.operationalStake * Math.max(0, predictionIndex.netExecutableOdd - 1);
    const compactReport = parseJson(row.calcio_deepscan_final_report_json, {});
    return {
        eventKey: eventKeyOf(row),
        betId: row.id,
        row: {
            id: row.id,
            prediction: row.prediction,
            market_type: row.market_type,
            odd: num(row.odd, 0),
            estimated_prob: num(row.estimated_prob, 0),
            edge_pp: num(row.edge_pp, num(row.edge, 0)),
            ev_pct: num(row.ev_pct, 0),
            ds_action: row.ds_action,
            calcio_quality_final_label: row.calcio_quality_final_label,
            calcio_analysis_stage_code: row.calcio_analysis_stage_code,
            calcio_analysis_stage_label: row.calcio_analysis_stage_label,
            calcio_analysis_stage_reason: row.calcio_analysis_stage_reason,
            calcio_analysis_only: num(row.calcio_analysis_only, 1),
            prediction_visibility: row.prediction_visibility,
            exposure_role: row.exposure_role,
            strategy_tag: row.strategy_tag,
            calcio_theoretical_stake: num(row.calcio_theoretical_stake, 0),
            calcio_operational_stake: num(row.calcio_operational_stake ?? row.stake, 0),
            calcio_portfolio_pre_cap_stake: num(row.calcio_portfolio_pre_cap_stake, 0),
            calcio_portfolio_post_cap_stake: num(row.calcio_portfolio_post_cap_stake, 0),
            calcio_portfolio_cap_reason: row.calcio_portfolio_cap_reason,
            calcio_portfolio_allocation_id: row.calcio_portfolio_allocation_id,
            calcio_event_finalization_id: row.calcio_event_finalization_id,
            calcio_analysis_batch_id: row.calcio_analysis_batch_id,
            calcio_portfolio_batch_status: row.calcio_portfolio_batch_status,
            calcio_portfolio_batch_certified: num(row.calcio_portfolio_batch_certified, 0),
            calcio_output_coherence_status: row.calcio_output_coherence_status,
            calcio_batch_output_coherence_status: row.calcio_batch_output_coherence_status,
            calcio_pt_certification_status: row.calcio_pt_certification_status,
            calcio_structural_certification_label: row.calcio_structural_certification_label,
            calcio_stake_lifecycle_status: row.calcio_stake_lifecycle_status,
            calcio_stake_lifecycle_reason: row.calcio_stake_lifecycle_reason,
            calcio_prediction_index_score: num(row.calcio_prediction_index_score, 0),
            calcio_prediction_index_label: row.calcio_prediction_index_label,
            calcio_prediction_index_reason: row.calcio_prediction_index_reason,
            calcio_prediction_index_rank_value: num(row.calcio_prediction_index_rank_value, 0),
            calcio_prediction_index_eligible: num(row.calcio_prediction_index_eligible, 0),
            calcio_net_executable_odd: num(row.calcio_net_executable_odd, num(row.odd, 0)),
            calcio_prediction_index_components: row.calcio_prediction_index_components,
            calcio_deepscan_final_state_version: row.calcio_deepscan_final_state_version,
            calcio_deepscan_final_state_action: row.calcio_deepscan_final_state_action,
            calcio_deepscan_final_state_score: num(row.calcio_deepscan_final_state_score, 0),
            calcio_deepscan_final_state_audit: row.calcio_deepscan_final_state_audit,
            calcio_deepscan_final_report_json: row.calcio_deepscan_final_report_json,
            bankroll_snapshot: num(row.bankroll_snapshot, 0),
            calcio_stake_authority_version: row.calcio_stake_authority_version,
            calcio_stake_authority_status: row.calcio_stake_authority_status,
            calcio_stake_authority_model_stake: num(row.calcio_stake_authority_model_stake, 0),
            calcio_stake_authority_reliability_stake: num(row.calcio_stake_authority_reliability_stake, 0),
            calcio_stake_authority_pre_cap_stake: num(row.calcio_stake_authority_pre_cap_stake, 0),
            calcio_stake_authority_final_stake: num(row.calcio_stake_authority_final_stake, 0),
            calcio_stake_probability_pct: num(row.calcio_stake_probability_pct, NaN),
            calcio_stake_bankroll_snapshot: num(row.calcio_stake_bankroll_snapshot, NaN),
            calcio_stake_bankroll_source: row.calcio_stake_bankroll_source,
            calcio_stake_authority_reason: row.calcio_stake_authority_reason,
            calcio_stake_authority_audit: row.calcio_stake_authority_audit,
            calcio_data_quality_authority_version: row.calcio_data_quality_authority_version,
            calcio_data_quality_score: num(row.calcio_data_quality_score, NaN),
            calcio_data_quality_status: row.calcio_data_quality_status,
            calcio_data_quality_label: row.calcio_data_quality_label,
            calcio_data_quality_blocking: num(row.calcio_data_quality_blocking, 0),
            calcio_data_quality_reasons: row.calcio_data_quality_reasons,
            calcio_data_quality_audit: row.calcio_data_quality_audit,
            calcio_bankroll_snapshot_consistent: num(row.calcio_bankroll_snapshot_consistent, 0),
            calcio_final_narrative: row.calcio_final_narrative,
            calcio_final_market_contract_version: row.calcio_final_market_contract_version,
            calcio_final_market_id: row.calcio_final_market_id,
            calcio_final_market_snapshot: row.calcio_final_market_snapshot,
            calcio_forecast_confidence_score: num(row.calcio_forecast_confidence_score, NaN),
            calcio_forecast_confidence_label: row.calcio_forecast_confidence_label,
            calcio_decision_state_version: row.calcio_decision_state_version,
            calcio_decision_state: row.calcio_decision_state,
            calcio_decision_state_reason: row.calcio_decision_state_reason,
            calcio_diagnostic_coherence_status: row.calcio_diagnostic_coherence_status,
            calcio_diagnostic_coherence_audit: row.calcio_diagnostic_coherence_audit,
            calcio_cross_market_reliability_version: row.calcio_cross_market_reliability_version,
            calcio_cross_market_stress_status: row.calcio_cross_market_stress_status,
            calcio_cross_market_stress_probability: num(row.calcio_cross_market_stress_probability, NaN),
            calcio_cross_market_gap_pp: num(row.calcio_cross_market_gap_pp, NaN),
            calcio_cross_market_lambda_home: num(row.calcio_cross_market_lambda_home, NaN),
            calcio_cross_market_lambda_away: num(row.calcio_cross_market_lambda_away, NaN),
            calcio_analysis_maturity_score: num(row.calcio_analysis_maturity_score, NaN),
            calcio_days_to_kickoff: num(row.calcio_days_to_kickoff, NaN),
            calcio_epistemic_uncertainty_score: num(row.calcio_epistemic_uncertainty_score, NaN),
            calcio_robust_probability: num(row.calcio_robust_probability, NaN),
            calcio_robust_ev_pct: num(row.calcio_robust_ev_pct, NaN),
            calcio_reliability_stake_multiplier: num(row.calcio_reliability_stake_multiplier, NaN),
            calcio_unadjusted_pre_cap_stake: num(row.calcio_unadjusted_pre_cap_stake, 0),
            calcio_reliability_adjusted_stake: num(row.calcio_reliability_adjusted_stake, 0),
            calcio_reliability_guard_status: row.calcio_reliability_guard_status,
            calcio_reliability_guard_audit: row.calcio_reliability_guard_audit
        },
        result: {
            ...compactReport,
            finalMarket: {
                marketId: row.calcio_final_market_id || null,
                prediction: row.prediction,
                marketType: row.market_type,
                odd: num(row.odd, 0),
                probability: num(row.estimated_prob, 0),
                edgePp: num(row.edge_pp, num(row.edge, 0)),
                evPct: num(row.ev_pct, 0)
            },
            finalMarketDiagnostic: parseJson(row.calcio_final_market_snapshot, null),
            decisionState: {
                version: row.calcio_decision_state_version,
                code: row.calcio_decision_state,
                label: parseJson(row.calcio_final_market_snapshot, {}).decisionState?.label || row.calcio_analysis_stage_label,
                reason: row.calcio_decision_state_reason
            },
            predictionIndex,
            stakeReconciliation: predictionIndex,
            stakeLifecycle: {
                theoreticalStake: num(row.calcio_stake_authority_model_stake, num(row.calcio_theoretical_stake, 0)),
                operationalStake: predictionIndex.operationalStake,
                estimatedOperationalProfit: predictionIndex.estimatedProfit,
                status: predictionIndex.status,
                action: predictionIndex.action,
                reason: predictionIndex.reason,
                automaticExecution: predictionIndex.eligible,
                dataClass: predictionIndex.dataClass
            },
            operationalState: {
                analysisOnly: num(row.calcio_analysis_only, 1) === 1,
                calcio_analysis_only: num(row.calcio_analysis_only, 1),
                prediction_visibility: row.prediction_visibility,
                exposure_role: row.exposure_role,
                strategy_tag: row.strategy_tag,
                certificationLabel: row.calcio_structural_certification_label,
                ptCertificationStatus: row.calcio_pt_certification_status
            },
            analysisStage: {
                code: row.calcio_analysis_stage_code,
                label: row.calcio_analysis_stage_label,
                summary: row.calcio_analysis_stage_reason
            },
            qualityFinalLabel: row.calcio_quality_final_label,
            outputCoherence: {
                status: row.calcio_batch_output_coherence_status || row.calcio_output_coherence_status,
                certified: (row.calcio_batch_output_coherence_status || row.calcio_output_coherence_status) === 'BATCH_OUTPUT_COHERENCE_CERTIFIED'
                    || row.calcio_output_coherence_status === 'OUTPUT_COHERENCE_CERTIFIED'
            },
            portfolioAllocation: {
                allocationId: row.calcio_portfolio_allocation_id,
                eventFinalizationId: row.calcio_event_finalization_id,
                batchId: row.calcio_analysis_batch_id,
                batchCertified: num(row.calcio_portfolio_batch_certified, 0) === 1,
                preCapStake: num(row.calcio_portfolio_pre_cap_stake, 0),
                postCapStake: num(row.calcio_portfolio_post_cap_stake, 0),
                capReason: row.calcio_portfolio_cap_reason
            }
        }
    };
}

function assertOnlyBatchEventsMutated(beforeRows, afterRows, allowedEventKeys) {
    const before = new Map(beforeRows.map(row => [row.id, digest(row)]));
    const mutated = [];
    for (const row of afterRows) {
        if (before.get(row.id) !== digest(row)) mutated.push(eventKeyOf(row));
    }
    const unique = [...new Set(mutated.filter(Boolean))];
    const foreign = unique.filter(key => !allowedEventKeys.has(key));
    if (foreign.length) {
        const error = new Error(`CALCIO_26C_CROSS_BATCH_WRITE:${foreign.join(',')}`);
        error.code = 'CALCIO_26C_CROSS_BATCH_WRITE';
        error.foreignEventKeys = foreign;
        throw error;
    }
    return unique;
}

function allocateBatch(db, options = {}) {
    ensureSchema(db);
    const batchId = text(options.batchId);
    if (!batchId) {
        const error = new Error('analysisBatchId obbligatorio.');
        error.code = 'CALCIO_26C_BATCH_ID_REQUIRED';
        throw error;
    }
    const professionalSelection = options.professionalSelection;
    if (!professionalSelection || typeof professionalSelection.applyPortfolioExposureCaps !== 'function') {
        const error = new Error('Allocatore portafoglio non disponibile.');
        error.code = 'CALCIO_26C_ALLOCATOR_REQUIRED';
        throw error;
    }
    const batch = getBatch(db, batchId);
    if (!batch) {
        const error = new Error(`Batch ${batchId} non trovato.`);
        error.code = 'CALCIO_26C_BATCH_NOT_FOUND';
        error.httpStatus = 404;
        throw error;
    }
    const batchEvents = getBatchEvents(db, batchId);
    if (!batchEvents.length) {
        const error = new Error(`Batch ${batchId} senza eventi osservati.`);
        error.code = 'CALCIO_26C_BATCH_EMPTY';
        error.httpStatus = 409;
        throw error;
    }
    const finalizations = getLatestFinalizations(db, batchId);
    const missing = batchEvents.filter(event => !isTerminalFinalization(finalizations.get(event.event_key)));
    if (missing.length) {
        const error = new Error(`Batch non pronto: ${missing.length} eventi non terminali.`);
        error.code = 'CALCIO_26C_BATCH_NOT_READY';
        error.httpStatus = 409;
        error.pendingEventKeys = missing.map(event => event.event_key);
        throw error;
    }
    const finalizationSummary = batchEvents.map(event => {
        const finalization = finalizations.get(event.event_key);
        return {
            eventKey: event.event_key,
            finalizationId: finalization?.finalization_id || null,
            status: finalization?.status || null,
            transactionId: finalization?.transaction_id || null,
            completedAt: finalization?.completed_at || null,
            finalizationStatus: finalization?.finalization_status || null,
            outputCoherenceStatus: finalization?.output_coherence_status || null,
            direct: num(finalization?.direct_finalized_count, 0),
            degraded: num(finalization?.degraded_finalized_count, 0),
            crossEvent: num(finalization?.cross_event_write_detected, 0)
        };
    });
    const completedEventCount = finalizationSummary.filter(item => text(item.status).toUpperCase() === 'COMPLETED').length;
    const failedEventCount = finalizationSummary.filter(item => text(item.status).toUpperCase() === 'FAILED').length;
    // PATCH 26D: un batch composto esclusivamente da errori non è certificabile e
    // non può scrivere COMMITTED_BATCH sulle righe evento.
    if (completedEventCount < 1) {
        const error = new Error(`Batch non certificabile: 0 eventi completati e ${failedEventCount} falliti.`);
        error.code = 'CALCIO_26D_BATCH_NO_COMPLETED_EVENTS';
        error.httpStatus = 409;
        error.completedEventCount = completedEventCount;
        error.failedEventCount = failedEventCount;
        throw error;
    }
    const finalizationDigest = digest(finalizationSummary);
    const existingAllocation = db.prepare(`
        SELECT * FROM calcio_ai_portfolio_batch_allocations
        WHERE batch_id = ? AND finalization_digest = ? AND version = ? AND status = 'COMMITTED_BATCH'
        ORDER BY created_at DESC LIMIT 1
    `).get(batchId, finalizationDigest, CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION);
    if (existingAllocation) {
        const snapshots = parseJson(existingAllocation.row_snapshot_json, []);
        return {
            success: true,
            idempotent: true,
            version: CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
            batchId,
            allocationId: existingAllocation.allocation_id,
            status: existingAllocation.status,
            rows: snapshots,
            totals: {
                preCapStake: num(existingAllocation.total_pre_cap_stake, 0),
                postCapStake: num(existingAllocation.total_post_cap_stake, 0)
            },
            caps: parseJson(existingAllocation.caps_json, {}),
            diagnostics: parseJson(existingAllocation.diagnostics_json, {})
        };
    }

    const rowEntries = batchEvents.map(event => ({
        event,
        finalization: finalizations.get(event.event_key),
        row: latestActiveRowForEvent(db, event.event_key, event.bet_id)
    }));
    const missingRows = rowEntries.filter(entry => !entry.row);
    if (missingRows.length) {
        const error = new Error(`Batch non allocabile: ${missingRows.length} righe PENDING mancanti.`);
        error.code = 'CALCIO_26C_BATCH_ROWS_MISSING';
        error.httpStatus = 409;
        error.missingEventKeys = missingRows.map(entry => entry.event.event_key);
        throw error;
    }

    const eventKeys = new Set(batchEvents.map(event => event.event_key));
    const successfulCandidates = [];
    const failureByEvent = new Map();
    for (const entry of rowEntries) {
        const { row, finalization, event } = entry;
        if (rowIsDirectlyCertifiable(row, finalization)) {
            successfulCandidates.push({
                ...row,
                event_key: event.event_key,
                eventKey: event.event_key,
                predictionIndex: hydratePredictionIndex(row),
                prediction_index: hydratePredictionIndex(row)
            });
        } else {
            const finalStatus = text(finalization?.status).toUpperCase();
            const reason = finalStatus === 'FAILED'
                ? `Finalizzazione DeepScan fallita: ${text(finalization?.error_code || finalization?.error_message || 'errore non specificato')}`
                : 'Evento non direttamente certificabile per ranking, coerenza o isolamento.';
            failureByEvent.set(event.event_key, reason);
        }
    }

    successfulCandidates.sort((a, b) =>
        num(b.predictionIndex?.rankValue ?? b.calcio_prediction_index_rank_value ?? b.calcio_prediction_index_score, 0)
        - num(a.predictionIndex?.rankValue ?? a.calcio_prediction_index_rank_value ?? a.calcio_prediction_index_score, 0)
        || eventKeyOf(a).localeCompare(eventKeyOf(b))
    );

    const allLatest = latestActiveRows(db);
    const existingRows = allLatest.filter(row => !eventKeys.has(eventKeyOf(row)));
    const bankroll = Math.max(0, num(batch.bankroll_snapshot, num(options.bankroll, 0)));
    const bankrollMismatches = rowEntries.filter(({ row }) => {
        const rowSnapshot = num(row.calcio_stake_bankroll_snapshot, num(row.bankroll_snapshot, NaN));
        return !Number.isFinite(rowSnapshot) || Math.abs(rowSnapshot - bankroll) > 0.01;
    }).map(({ row, event }) => ({ eventKey: event.event_key, rowId: row.id, rowBankroll: row.calcio_stake_bankroll_snapshot ?? row.bankroll_snapshot, batchBankroll: bankroll }));
    if (bankrollMismatches.length) {
        const error = new Error(`PATCH26EC_BANKROLL_SNAPSHOT_MISMATCH: ${bankrollMismatches.length} eventi non coerenti con il batch.`);
        error.code = 'PATCH26EC_BANKROLL_SNAPSHOT_MISMATCH';
        error.mismatches = bankrollMismatches;
        throw error;
    }
    const caps = {
        totalExposurePct: num(options.caps?.totalExposurePct, 5),
        longshotExposurePct: num(options.caps?.longshotExposurePct, 1),
        kickoffExposurePct: num(options.caps?.kickoffExposurePct, 2)
    };
    const allocation = professionalSelection.applyPortfolioExposureCaps(
        successfulCandidates,
        bankroll,
        existingRows,
        caps
    );
    const allocatedByEvent = new Map((allocation.candidates || []).map(row => [eventKeyOf(row), row]));
    const allocationId = makeId('CALCIO_BATCH_ALLOCATION');
    const beforeRows = latestActiveRows(db);
    const allowedColumns = columnNames(db, 'ai_forward_test');

    const transactionResult = runTransaction(db, () => {
        for (const entry of rowEntries) {
            const { row, finalization, event } = entry;
            const allocated = allocatedByEvent.get(event.event_key);
            let predictionIndex;
            let failureReason = failureByEvent.get(event.event_key) || null;
            if (allocated) {
                predictionIndex = allocated.predictionIndex || allocated.prediction_index || hydratePredictionIndex(row);
            } else {
                predictionIndex = {
                    ...hydratePredictionIndex(row),
                    operationalStake: 0,
                    eligible: false,
                    allowBet: false,
                    status: 'UNIFIED_STAKE_AUTHORITY_NO_STAKE',
                    action: 'ANALYSIS_ONLY_UNIFIED_STAKE_AUTHORITY',
                    gateStatus: 'CALCIO_WATCHLIST_MICRO',
                    reason: failureReason || 'Evento escluso dalla allocazione batch.',
                    estimatedProfit: 0,
                    portfolioCapApplied: false,
                    portfolioCapReason: failureReason || null
                };
            }
            const patch56PortfolioRiskDecision = unifiedCrossSportPortfolioRiskAuthorityPatch56.decide({
                sport: 'CALCIO',
                betId: row.id,
                eventKey: event.event_key,
                home_team: row.home_team,
                away_team: row.away_team,
                match_date: row.match_date,
                proposedStake: Math.max(0, num(predictionIndex.operationalStake, 0)),
                bankrollSnapshot: bankroll
            }, { db, projectRoot: options.projectRoot || path.join(__dirname, '..') });
            const fields = {
                ...buildUpdateFields(row, predictionIndex, allocationId, batchId, finalization, failureReason),
                ...unifiedCrossSportPortfolioRiskAuthorityPatch56.toPersistenceFields(patch56PortfolioRiskDecision)
            };
            const entries = Object.entries(fields).filter(([name]) => allowedColumns.has(name));
            db.prepare(`UPDATE ai_forward_test SET ${entries.map(([name]) => `${name} = ?`).join(', ')} WHERE id = ?`)
                .run(...entries.map(([, value]) => value), row.id);
            unifiedCrossSportPortfolioRiskAuthorityPatch56.persistDecision(db, patch56PortfolioRiskDecision);
            const authorityAudit = parseJson(row.calcio_stake_authority_audit, {});
            const dataQualityAudit = parseJson(row.calcio_data_quality_audit, {});
            db.prepare(`
                INSERT INTO calcio_stake_authority_audit_log
                (authority_version, batch_id, event_key, bet_id, bankroll_snapshot,
                 model_stake, reliability_stake, final_stake, robust_ev_pct,
                 data_quality_status, status, reason, audit_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                text(row.calcio_stake_authority_version || authorityAudit.version || 'BETTING_PATCH_26E_C_UNIFIED_STAKE_AUTHORITY_V1'),
                batchId,
                event.event_key,
                row.id,
                num(row.calcio_stake_bankroll_snapshot, num(row.bankroll_snapshot, bankroll)),
                num(row.calcio_stake_authority_model_stake, authorityAudit.modelStake),
                num(row.calcio_stake_authority_reliability_stake, authorityAudit.reliabilityStake),
                num(fields.calcio_stake_authority_final_stake, 0),
                num(row.calcio_robust_ev_pct, authorityAudit.robustEvPct),
                text(row.calcio_data_quality_status || dataQualityAudit.status),
                text(fields.calcio_stake_authority_status),
                text(fields.calcio_stake_authority_reason),
                json({ authority: authorityAudit, dataQuality: dataQualityAudit, allocationId }),
                nowIso()
            );
            const finalMarketDiagnostic = parseJson(fields.calcio_final_market_snapshot, {});
            db.prepare(`
                INSERT INTO calcio_final_market_contract_audit_log
                (contract_version, batch_id, event_key, bet_id, market_id, prediction,
                 market_type, decision_state, coherence_status, snapshot_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                text(fields.calcio_final_market_contract_version || finalMarketDiagnostic.version || calcioFinalMarketDiagnosticContract.CALCIO_FINAL_MARKET_DIAGNOSTIC_VERSION),
                batchId,
                event.event_key,
                row.id,
                text(fields.calcio_final_market_id || finalMarketDiagnostic.marketId),
                text(finalMarketDiagnostic.prediction || row.prediction),
                text(finalMarketDiagnostic.marketType || row.market_type),
                text(fields.calcio_decision_state || finalMarketDiagnostic.decisionState?.code),
                text(fields.calcio_diagnostic_coherence_status || finalMarketDiagnostic.coherence?.status),
                json(finalMarketDiagnostic),
                nowIso()
            );
        }

        const afterRows = latestActiveRows(db);
        const mutatedEventKeys = assertOnlyBatchEventsMutated(beforeRows, afterRows, eventKeys);
        const snapshots = rowEntries.map(entry => {
            const refreshed = db.prepare('SELECT * FROM ai_forward_test WHERE id = ?').get(entry.row.id);
            return snapshotRow(refreshed);
        });
        const totalPre = snapshots.reduce((sum, item) => sum + num(item.row.calcio_portfolio_pre_cap_stake, 0), 0);
        const totalPost = snapshots.reduce((sum, item) => sum + num(item.row.calcio_portfolio_post_cap_stake, 0), 0);
        const diagnostics = {
            finalizationDigest,
            expectedEventCount: batchEvents.length,
            terminalEventCount: batchEvents.length,
            completedEventCount,
            failedEventCount,
            eligibleEventCount: snapshots.filter(item => item.result.predictionIndex.eligible).length,
            mutatedEventKeys,
            existingExternalExposureCount: existingRows.filter(row => num(row.calcio_operational_stake ?? row.stake, 0) > 0).length,
            orderIndependent: true,
            eventFinalizationIdsPreserved: true,
            bankrollSnapshot: bankroll,
            bankrollSnapshotConsistent: true,
            stakeAuthority: 'EXCLUSIVE_STAKE_AMOUNT_AUTHORITY'
        };
        db.prepare(`
            INSERT INTO calcio_ai_portfolio_batch_allocations
            (allocation_id, version, batch_id, finalization_digest, bankroll_snapshot, status,
             expected_event_count, terminal_event_count, completed_event_count, failed_event_count,
             eligible_event_count, total_pre_cap_stake, total_post_cap_stake, caps_json,
             event_keys_json, row_snapshot_json, created_at, diagnostics_json)
            VALUES (?, ?, ?, ?, ?, 'COMMITTED_BATCH', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            allocationId,
            CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
            batchId,
            finalizationDigest,
            bankroll,
            batchEvents.length,
            batchEvents.length,
            diagnostics.completedEventCount,
            diagnostics.failedEventCount,
            diagnostics.eligibleEventCount,
            totalPre,
            totalPost,
            json(caps),
            json([...eventKeys]),
            json(snapshots),
            nowIso(),
            json(diagnostics)
        );
        if (columnNames(db, 'calcio_ai_observation_allocations').size) {
            db.prepare(`
                INSERT INTO calcio_ai_observation_allocations
                (allocation_id, version, batch_id, triggering_event_key, status, active_event_count,
                 total_pre_cap_stake, total_post_cap_stake, mutated_event_keys_json, caps_json, created_at, diagnostics_json)
                VALUES (?, ?, ?, NULL, 'COMMITTED_BATCH', ?, ?, ?, ?, ?, ?, ?)
            `).run(
                allocationId,
                CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
                batchId,
                batchEvents.length,
                totalPre,
                totalPost,
                json(mutatedEventKeys),
                json(caps),
                nowIso(),
                json(diagnostics)
            );
        }
        db.prepare(`
            UPDATE calcio_ai_observation_batches
            SET status = 'PORTFOLIO_ALLOCATED', completed_at = ?, diagnostics_json = ?
            WHERE batch_id = ?
        `).run(nowIso(), json({ ...parseJson(batch.diagnostics_json, {}), portfolioAllocationId: allocationId, portfolioBatchCertified: true }), batchId);
        return { snapshots, totalPre, totalPost, diagnostics, mutatedEventKeys };
    });

    const committed = transactionResult;
    return {
        success: true,
        idempotent: false,
        version: CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
        batchId,
        allocationId,
        status: 'COMMITTED_BATCH',
        rows: committed.snapshots,
        totals: { preCapStake: committed.totalPre, postCapStake: committed.totalPost },
        limits: allocation.limits,
        existing: allocation.existing,
        allocated: allocation.allocated,
        caps,
        diagnostics: committed.diagnostics
    };
}

function auditBatch(db, batchId) {
    ensureSchema(db);
    const batch = getBatch(db, batchId);
    const events = getBatchEvents(db, batchId);
    const finalizations = getLatestFinalizations(db, batchId);
    const allocation = db.prepare(`
        SELECT * FROM calcio_ai_portfolio_batch_allocations
        WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1
    `).get(batchId) || null;
    return {
        success: Boolean(batch),
        readOnly: true,
        version: CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
        batch,
        events: events.map(event => ({ ...event, finalization: finalizations.get(event.event_key) || null })),
        allocation: allocation ? {
            ...allocation,
            caps: parseJson(allocation.caps_json, {}),
            eventKeys: parseJson(allocation.event_keys_json, []),
            diagnostics: parseJson(allocation.diagnostics_json, {})
        } : null
    };
}

module.exports = {
    CALCIO_BATCH_PORTFOLIO_ALLOCATOR_VERSION,
    MINIMUM_OPERATIONAL_STAKE,
    ensureSchema,
    eventKeyOf,
    hydratePredictionIndex,
    getBatchEvents,
    getLatestFinalizations,
    allocateBatch,
    auditBatch,
    snapshotRow,
    rowIsDirectlyCertifiable,
    assertOnlyBatchEventsMutated
};
