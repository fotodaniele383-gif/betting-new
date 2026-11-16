'use strict';

const CALCIO_EVENT_FINALIZATION_ISOLATION_VERSION = 'BETTING_PATCH_26B_EVENT_ISOLATION_V1';

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
    return String(value ?? '').trim();
}

function eventKeyOf(row = {}) {
    return text(row.match_exposure_key || row.calcio_event_key || row.event_key || row.eventKey)
        || [text(row.home_team || row.home), text(row.away_team || row.away), text(row.match_date || row.date || row.commence_time)].join('|');
}

function buildFullCandidateAudit(analysisCandidates = [], selectedCandidate = null, professionalSelection) {
    if (!professionalSelection || typeof professionalSelection.selectPrimary !== 'function') {
        throw new Error('CALCIO_26B_PROFESSIONAL_SELECTION_REQUIRED');
    }
    const complete = professionalSelection.selectPrimary(Array.isArray(analysisCandidates) ? analysisCandidates : []);
    const selected = selectedCandidate || complete.selected || null;
    return {
        version: CALCIO_EVENT_FINALIZATION_ISOLATION_VERSION,
        selected,
        ranked: complete.ranked || [],
        audit: complete.audit || null,
        candidatePoolCount: Array.isArray(complete.ranked) ? complete.ranked.length : 0,
        eligibleCandidateCount: (Array.isArray(analysisCandidates) ? analysisCandidates : []).filter(candidate => candidate?.predictionIndex?.eligible === true || candidate?.prediction_index?.eligible === true).length
    };
}

function allocateCurrentEventOnly(options = {}) {
    const { currentRow, latestRows = [], bankroll = 0, professionalSelection, caps = {} } = options;
    if (!currentRow) throw new Error('CALCIO_26B_CURRENT_ROW_REQUIRED');
    if (!professionalSelection || typeof professionalSelection.applyPortfolioExposureCaps !== 'function') {
        throw new Error('CALCIO_26B_PORTFOLIO_ALLOCATOR_REQUIRED');
    }
    const currentKey = eventKeyOf(currentRow);
    const existingRows = (Array.isArray(latestRows) ? latestRows : []).filter(row => {
        if (currentRow.id && row.id === currentRow.id) return false;
        return eventKeyOf(row) !== currentKey;
    });
    const allocation = professionalSelection.applyPortfolioExposureCaps(
        [currentRow],
        bankroll,
        existingRows,
        {
            totalExposurePct: num(caps.totalExposurePct, 5),
            longshotExposurePct: num(caps.longshotExposurePct, 1),
            kickoffExposurePct: num(caps.kickoffExposurePct, 2)
        }
    );
    const allocatedCurrent = (allocation.candidates || []).find(row => {
        if (currentRow.id && row.id === currentRow.id) return true;
        return eventKeyOf(row) === currentKey;
    });
    if (!allocatedCurrent) {
        const error = new Error('CALCIO_26B_CURRENT_EVENT_NOT_ALLOCATED');
        error.code = 'CALCIO_26B_EVENT_LOCAL_ALLOCATION_INCOMPLETE';
        throw error;
    }
    return {
        ...allocation,
        version: CALCIO_EVENT_FINALIZATION_ISOLATION_VERSION,
        mode: 'EVENT_LOCAL_INCREMENTAL_CAP_PREVIEW',
        portfolioBatchCertified: false,
        currentEventKey: currentKey,
        existingEventCount: existingRows.length,
        candidates: [allocatedCurrent]
    };
}

function assertOnlyCurrentEventMutated(beforeRows = [], afterRows = [], currentEventKey = '') {
    const beforeById = new Map((Array.isArray(beforeRows) ? beforeRows : []).map(row => [row.id, row]));
    const mutated = [];
    for (const row of Array.isArray(afterRows) ? afterRows : []) {
        const before = beforeById.get(row.id);
        if (!before) continue;
        if (JSON.stringify(before) !== JSON.stringify(row)) mutated.push(eventKeyOf(row));
    }
    const unique = [...new Set(mutated.filter(Boolean))];
    const foreign = unique.filter(key => key !== currentEventKey);
    if (foreign.length) {
        const error = new Error(`CALCIO_26B_CROSS_EVENT_WRITE:${foreign.join(',')}`);
        error.code = 'CALCIO_26B_CROSS_EVENT_WRITE';
        error.foreignEventKeys = foreign;
        throw error;
    }
    return { success: true, mutatedEventKeys: unique, currentEventKey };
}

module.exports = {
    CALCIO_EVENT_FINALIZATION_ISOLATION_VERSION,
    eventKeyOf,
    buildFullCandidateAudit,
    allocateCurrentEventOnly,
    assertOnlyCurrentEventMutated
};
