'use strict';

const entityResolution = require('./calcioEntityResolution');

const CALCIO_UNDERSTAT_CONTRACT_VERSION = 'CALCIO_PATCH_7_UNDERSTAT_DUAL_TEAM_CONTRACT_V1';

const STATUS = Object.freeze({
    AVAILABLE_BOTH_TEAMS: 'AVAILABLE_BOTH_TEAMS',
    PARTIAL_HOME_ONLY: 'PARTIAL_HOME_ONLY',
    PARTIAL_AWAY_ONLY: 'PARTIAL_AWAY_ONLY',
    UNMATCHED_TEAM_NAMES: 'UNMATCHED_TEAM_NAMES',
    INVALID_EMPTY_TEAM: 'INVALID_EMPTY_TEAM',
    INVALID_METRICS: 'INVALID_METRICS',
    MISSING: 'MISSING',
    ERROR: 'ERROR'
});

function strictFinite(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function sanitizeUnderstatData(raw = {}) {
    const valid = {};
    const rejected = [];
    for (const [teamName, metrics] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
        const team = String(teamName || '').trim();
        if (!team) {
            rejected.push({ teamName, reason: STATUS.INVALID_EMPTY_TEAM });
            continue;
        }
        const xGFor = strictFinite(metrics?.xG_for ?? metrics?.xgFor ?? metrics?.xGFor);
        const xGAgainst = strictFinite(metrics?.xG_against ?? metrics?.xgAgainst ?? metrics?.xGAgainst);
        if (xGFor === null || xGAgainst === null || xGFor < 0 || xGAgainst < 0 || xGFor > 6 || xGAgainst > 6) {
            rejected.push({ teamName: team, reason: STATUS.INVALID_METRICS, xGFor, xGAgainst });
            continue;
        }
        valid[team] = { xG_for: Number(xGFor.toFixed(3)), xG_against: Number(xGAgainst.toFixed(3)) };
    }
    return { valid, rejected };
}

function evaluateUnderstatCoverage(raw = {}, homeTeam = '', awayTeam = '') {
    const sanitized = sanitizeUnderstatData(raw);
    const candidates = Object.keys(sanitized.valid);
    if (!candidates.length) {
        const emptyRejected = sanitized.rejected.some(item => item.reason === STATUS.INVALID_EMPTY_TEAM);
        return {
            version: CALCIO_UNDERSTAT_CONTRACT_VERSION,
            status: emptyRejected ? STATUS.INVALID_EMPTY_TEAM : STATUS.MISSING,
            available: false,
            bothTeams: false,
            home: null,
            away: null,
            validTeamCount: 0,
            rejected: sanitized.rejected
        };
    }
    const homeResolution = entityResolution.resolveTeamName(homeTeam, candidates, { threshold: 0.82 });
    const awayResolution = entityResolution.resolveTeamName(awayTeam, candidates, { threshold: 0.82 });
    const home = homeResolution.matched ? { ...homeResolution, metrics: sanitized.valid[homeResolution.resolved] } : null;
    const away = awayResolution.matched ? { ...awayResolution, metrics: sanitized.valid[awayResolution.resolved] } : null;

    let status = STATUS.UNMATCHED_TEAM_NAMES;
    if (home && away) status = STATUS.AVAILABLE_BOTH_TEAMS;
    else if (home) status = STATUS.PARTIAL_HOME_ONLY;
    else if (away) status = STATUS.PARTIAL_AWAY_ONLY;

    return {
        version: CALCIO_UNDERSTAT_CONTRACT_VERSION,
        status,
        available: status === STATUS.AVAILABLE_BOTH_TEAMS,
        bothTeams: status === STATUS.AVAILABLE_BOTH_TEAMS,
        home,
        away,
        homeResolution,
        awayResolution,
        validTeamCount: candidates.length,
        validTeams: candidates,
        rejected: sanitized.rejected
    };
}

module.exports = {
    CALCIO_UNDERSTAT_CONTRACT_VERSION,
    STATUS,
    strictFinite,
    sanitizeUnderstatData,
    evaluateUnderstatCoverage
};
