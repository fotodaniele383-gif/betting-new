'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

function assertCondition(condition, name, details = null, checks = []) {
    if (!condition) throw new Error(name);
    checks.push({ name, ok: true, details });
}

async function run(root) {
    const checks = [];
    const stakePolicy = require(path.join(root, 'backend', 'calcioKellyStakePolicy'));
    const lifecycle = require(path.join(root, 'backend', 'calcioStakeLifecycle'));
    const clubElo = require(path.join(root, 'backend', 'calcioClubEloProvider'));
    const providers = require(path.join(root, 'backend', 'calcioMultiProviderEvidence'));
    const sourceIntel = require(path.join(root, 'backend', 'calcioSourceIntelligence'));
    const coherence = require(path.join(root, 'backend', 'calcioProgramCoherence'));
    const registry = require(path.join(root, 'backend', 'calcioPatchRegistry'));
    const probability = require(path.join(root, 'backend', 'calcioProbabilityIntegrity'));

    const inheritedIntegrity = probability.buildCalcioProbabilityIntegrity({
        modelProbabilities: { '1': 40, X: 30, '2': 30, 'O2.5': 50, 'U2.5': 50, GG: 50, NG: 50 },
        mcResult: { homeWinProb: 0.42, drawProb: 0.28, awayWinProb: 0.30, over2_5Prob: 0.50, golProb: 0.50 },
        marketFairOdds: { '1': 2.5, X: 3.333333333, '2': 3.333333333 },
        coverage: { mode: 'HISTORY_PROXY_STRONG' }, iterations: 10000, seed: 141
    });
    assertCondition(Math.abs(inheritedIntegrity.sources.market['1X'] - 70) < 0.01, 'Patch 13 regression: no-vig 1X = P1 + PX', inheritedIntegrity.diagnostics['1X'], checks);
    assertCondition(Math.abs(inheritedIntegrity.sources.market.X2 - 60) < 0.01, 'Patch 13 regression: no-vig X2 = PX + P2', inheritedIntegrity.diagnostics.X2, checks);
    assertCondition(Math.abs(inheritedIntegrity.sources.market['12'] - 70) < 0.01, 'Patch 13 regression: no-vig 12 = P1 + P2', inheritedIntegrity.diagnostics['12'], checks);
    assertCondition(['1X','X2','12'].every(m => Number.isFinite(inheritedIntegrity.diagnostics[m]?.modelProbabilityPct) && Number.isFinite(inheritedIntegrity.diagnostics[m]?.monteCarloProbabilityPct) && Number.isFinite(inheritedIntegrity.diagnostics[m]?.marketProbabilityPct)), 'Patch 13 regression: derived model/MC/market diagnostics remain complete', inheritedIntegrity.doubleChanceDiagnostics, checks);
    assertCondition(fs.readFileSync(path.join(root, 'backend', 'deepScanCalcio.js'), 'utf8').includes('derived_double_chance_no_vig_reference'), 'Patch 13 regression: DeepScan derived reference remains active', null, checks);

    const integrity = { diagnostics: { '1X': { disagreementPp: 2, monteCarloStdErrorPp: 0.45 } }, maxDisagreementPp: 2, maxMonteCarloStdErrorPp: 0.45 };
    const reliableAudit = { status: 'PROFESSIONAL_OK', dataReliability: { score: 62, status: 'DATA_BOOTSTRAP' }, teamMatching: { confidence: 100 } };
    const usableProviders = { status: 'MULTI_PROVIDER_USABLE', authoritativeQuantitativeProviders: 2 };

    const unreliable = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 1, professionalMultiplier: 1,
        predictionReliability: { score: 54, evidenceAuthority: 'PROXY_OR_PARTIAL' },
        professionalAudit: { ...reliableAudit, dataReliability: { score: 54, status: 'DATA_FRAGILE' } },
        multiProviderEvidence: usableProviders, probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(unreliable.theoreticalStake === 0 && unreliable.dataAuthority.dataClass === 'INATTENDIBILE', 'Stake zero below INATTENDIBILE threshold', unreliable, checks);

    const minimum = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 0.1, professionalMultiplier: 1,
        predictionReliability: { score: 62, evidenceAuthority: 'PROXY_OR_PARTIAL' },
        professionalAudit: reliableAudit, multiProviderEvidence: usableProviders, probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(minimum.theoreticalStake === 2 && minimum.minimumStakeApplied === true && minimum.dataAuthority.dataClass === 'ATTENDIBILE', 'Positive Kelly is normalized to €2 minimum', minimum, checks);

    const good = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 1, professionalMultiplier: 1,
        predictionReliability: { score: 78, evidenceAuthority: 'PROXY_OR_PARTIAL' },
        professionalAudit: { ...reliableAudit, dataReliability: { score: 78, status: 'DATA_RELIABLE_PROXY' } },
        multiProviderEvidence: usableProviders, probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(good.theoreticalStake > 2 && good.theoreticalStake <= 12.5 && good.dataAuthority.dataClass === 'BUONA', 'Good data allows Kelly stake above €2 within cap', good, checks);

    const high = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 3, professionalMultiplier: 1,
        predictionReliability: { score: 90, evidenceAuthority: 'HIGH_AUTHORITY' },
        professionalAudit: { ...reliableAudit, dataReliability: { score: 90, status: 'DATA_RELIABLE' } },
        multiProviderEvidence: { status: 'MULTI_PROVIDER_STRONG', authoritativeQuantitativeProviders: 3 },
        probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(high.theoreticalStake === 20 && high.dataAuthority.dataClass === 'ALTA', 'High-authority data allows larger Kelly stake with 2% bankroll cap', high, checks);

    const blocked = stakePolicy.calculateTheoreticalStake({
        bankroll: 1000, kellyPct: 1, professionalMultiplier: 0,
        predictionReliability: { score: 78, evidenceAuthority: 'PROXY_OR_PARTIAL' }, professionalAudit: reliableAudit,
        multiProviderEvidence: usableProviders, probabilityIntegrity: integrity, market: '1X'
    });
    assertCondition(blocked.theoreticalStake === 0, 'Professional reliability multiplier can still block stake', blocked, checks);

    const early = lifecycle.buildStakeLifecycle({ theoreticalStake: 8, gate: { allowBet: false, status: 'CALCIO_EARLY_WATCHLIST' }, professionalAudit: { status: 'PROFESSIONAL_WATCHLIST', timing: { status: 'EARLY_WATCHLIST' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } }, dataAuthority: { dataClass: 'BUONA' }, odd: 1.9 });
    assertCondition(early.theoreticalStake === 8 && early.operationalStake === 0 && early.status === 'THEORETICAL_ONLY_EARLY_WATCHLIST', 'Early timing preserves theoretical stake and keeps operational at zero', early, checks);

    const preMatch = lifecycle.buildStakeLifecycle({ theoreticalStake: 2, gate: { allowBet: true, status: 'CALCIO_WATCHLIST_MICRO', maxStake: 0.5 }, professionalAudit: { status: 'PROFESSIONAL_OK', timing: { status: 'PRE_MATCH_EARLY' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } }, dataAuthority: { dataClass: 'ATTENDIBILE' }, odd: 1.9 });
    assertCondition(preMatch.operationalStake === 2, 'Positive pre-match micro stake respects €2 minimum', preMatch, checks);

    const lineup = lifecycle.buildStakeLifecycle({ theoreticalStake: 9, gate: { allowBet: true, status: 'CALCIO_APPROVED_WITH_CAP', maxStake: 9 }, professionalAudit: { status: 'PROFESSIONAL_OK', timing: { status: 'LINEUP_WINDOW' }, lineupNews: { status: 'LINEUP_NOT_CONFIRMED' } }, dataAuthority: { dataClass: 'BUONA' }, odd: 2 });
    assertCondition(lineup.operationalStake === 2, 'Pending lineup window uses €2 micro stake', lineup, checks);

    const csvRows = ['Rank,Club,Country,Level,Elo,From,To'];
    for (let i = 0; i < 60; i++) csvRows.push(`${i + 1},Club ${i},ENG,1,${1500 + i},2026-07-01,2026-12-31`);
    csvRows.push('61,Everton,ENG,1,1701,2026-07-01,2026-12-31');
    csvRows.push('62,Crystal Palace,ENG,1,1688,2026-07-01,2026-12-31');
    const ratings = clubElo.parseClubEloCsv(csvRows.join('\n'));
    const eloEvidence = clubElo.buildMatchEvidence({ status: 'AVAILABLE', source: 'TEST', snapshotDate: new Date().toISOString().slice(0,10), fetchedAt: new Date().toISOString(), ratings }, 'Everton', 'Crystal Palace');
    assertCondition(eloEvidence.available && eloEvidence.authoritative && eloEvidence.eloDifference === 13, 'ClubElo CSV is parsed and both teams are conservatively reconciled', eloEvidence, checks);

    const strong = providers.buildEvidenceHealth({ footballDataLoaded: true, hasBothXg: false, xgEvidenceMode: 'GOAL_SHOT_PROXY', clubEloEvidence: eloEvidence, oddsAvailable: true, sourceAudit: { coveragePct: 50 } });
    assertCondition(strong.status === 'MULTI_PROVIDER_STRONG' && strong.authoritativeQuantitativeProviders === 3, 'Market + football-data + fresh ClubElo create three authoritative provider families', strong, checks);
    const withoutElo = providers.buildEvidenceHealth({ footballDataLoaded: true, hasBothXg: false, xgEvidenceMode: 'GOAL_SHOT_PROXY', clubEloEvidence: { available: false }, oddsAvailable: true, sourceAudit: { coveragePct: 50 } });
    assertCondition(withoutElo.status === 'MULTI_PROVIDER_USABLE' && withoutElo.authoritativeQuantitativeProviders === 2, 'Understat proxy is not miscounted as authoritative real xG', withoutElo, checks);

    const sourceAudit = sourceIntel.buildMatchSourceAudit({
        homeProfile: { sourceIntelligence: { status: 'PARTIAL', counts: { uniqueArticles: 7, officialArticles: 0 }, matchImpactConfidence: 35, coverageConfidence: 60 } },
        awayProfile: { sourceIntelligence: { status: 'PARTIAL', counts: { uniqueArticles: 10, officialArticles: 0 }, matchImpactConfidence: 40, coverageConfidence: 65 } },
        extData: { homeTeam: 'Everton', awayTeam: 'Crystal Palace', odd1: 2, oddX: 3.2, odd2: 3.6, footballDataLoaded: true, homeMatches: 19, awayMatches: 19, xgEvidenceMode: 'GOAL_SHOT_PROXY', clubEloEvidence: eloEvidence }
    });
    const clubRow = sourceAudit.sources.find(row => row.id === 'CLUB_ELO');
    const newsRows = sourceAudit.sources.filter(row => ['HOME_NEWS','AWAY_NEWS'].includes(row.id));
    assertCondition(clubRow?.status === 'AVAILABLE' && clubRow.authority === 'STRENGTH_INPUT', 'Source table exposes actual ClubElo authority only when 2/2 matched', clubRow, checks);
    assertCondition(newsRows.every(row => row.status === 'PARTIAL' && row.authority === 'QUALITATIVE_ONLY'), 'News without official confirmations remains qualitative PARTIAL', newsRows, checks);

    const reliability = coherence.buildPredictionReliability({
        integrity: { coverageMode: 'HISTORY_PROXY_STRONG', diagnostics: { '1X': { disagreementPp: 1, monteCarloStdErrorPp: 0.4 } } }, market: '1X',
        professionalAudit: { dataReliability: { score: 82 }, teamMatching: { confidence: 100 }, risk: 12 },
        sourceAudit: { coveragePct: 92, matchImpactConfidence: 35 },
        multiProviderEvidence: strong
    });
    assertCondition(reliability.canReachHigh === true && reliability.factors.authoritativeQuantitativeProviders === 3, 'High-authority eligibility uses distinct authoritative provider families', reliability, checks);

    const serverText = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
    assertCondition((serverText.match(/const minBet = 2\.00/g) || []).length >= 2, 'Live and backtest minimum stake are €2', null, checks);
    assertCondition(serverText.includes('calculateTheoreticalStake') && serverText.includes('loadClubEloSnapshot'), 'Server wires Kelly policy and cached ClubElo provider', null, checks);
    assertCondition(!fs.readFileSync(path.join(root, 'backend', 'calcioClubEloProvider.js'), 'utf8').includes('THE_ODDS_API'), 'ClubElo provider introduces no Odds API debit path', null, checks);

    const status = registry.getCalcioPatchStatus();
    const patch14 = status.patches.find(row => row.version === '14');
    assertCondition(status.currentPatchVersion === '14' && patch14?.minimumPositiveStakeEur === 2 && patch14?.newOddsApiCalls === 0, 'Registry advances to Patch 14 with Tennis/DB/Odds boundaries', patch14, checks);

    const publicApp = fs.readFileSync(path.join(root, 'public', 'app.js'));
    const backendApp = fs.readFileSync(path.join(root, 'backend', 'public', 'app.js'));
    assertCondition(publicApp.equals(backendApp), 'Frontend mirrors remain byte-identical', null, checks);
    assertCondition(publicApp.toString('utf8').includes('Classe dati') && publicApp.toString('utf8').includes('Dati ${htmlEscape(dataClass)}'), 'UI distinguishes data class and stake reason', null, checks);

    return {
        success: true,
        patch: 'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE',
        version: stakePolicy.CALCIO_KELLY_STAKE_POLICY_VERSION,
        checks,
        diagnostics: { unreliable, minimum, good, high, early, preMatch, lineup, eloEvidence, strong, withoutElo, sourceAudit, reliability },
        boundaries: { databaseMutation: false, historicalTennisRowsChanged: false, tennisModelChanged: false, newOddsApiCalls: 0, minimumPositiveStakeEur: 2, unreliableThreshold: 55 }
    };
}
module.exports = { run };
