// ============================================================================
// STEP60 - CALCIO PROFESSIONAL GUARDRAILS
// Lineup/news, data reliability, team matching, timing operativo e correlazioni.
// Advisory-only: non modifica modello, probabilita, edge/EV o Tennis.
// ============================================================================

const STEP60_CALCIO_PROFESSIONAL_GUARD_VERSION = 'BETTING_PATCH_14_PROFESSIONAL_DATA_GATE_V3';

function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}


function strictFinite(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function round(value, decimals = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function normalizeText(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const TEAM_ALIAS_CANONICAL = new Map(Object.entries({
    'man utd': 'manchester united',
    'man united': 'manchester united',
    'manchester utd': 'manchester united',
    'man city': 'manchester city',
    'inter': 'internazionale',
    'inter milan': 'internazionale',
    'internazionale milano': 'internazionale',
    'ac milan': 'milan',
    'as roma': 'roma',
    'roma as': 'roma',
    'real betis': 'betis',
    'athletic bilbao': 'athletic club',
    'spurs': 'tottenham',
    'tottenham hotspur': 'tottenham',
    'psg': 'paris saint germain',
    'paris sg': 'paris saint germain',
    'bayern munich': 'bayern munchen',
    'bayern m': 'bayern munchen',
    'borussia dortmund': 'dortmund',
    'b dortmund': 'dortmund'
}));

function canonicalTeamName(value = '') {
    const n = normalizeText(value);
    return TEAM_ALIAS_CANONICAL.get(n) || n;
}

function tokenSet(value = '') {
    return new Set(canonicalTeamName(value).split(/\s+/).filter(Boolean));
}

function scoreTeamNameMatch(a = '', b = '') {
    const ca = canonicalTeamName(a);
    const cb = canonicalTeamName(b);
    if (!ca || !cb) return 0;
    if (ca === cb) return 100;
    if (ca.includes(cb) || cb.includes(ca)) return 88;
    const ta = tokenSet(ca);
    const tb = tokenSet(cb);
    const union = new Set([...ta, ...tb]);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    if (!union.size) return 0;
    return round((inter / union.size) * 100, 1);
}

function buildTeamMatchingAudit({ home, away, extData = {} } = {}) {
    const homeRefs = [extData.homeCsvName, extData.home_csv_name, extData.homeUnderstatName, extData.home_understat_name, extData.homeProviderName].filter(Boolean);
    const awayRefs = [extData.awayCsvName, extData.away_csv_name, extData.awayUnderstatName, extData.away_understat_name, extData.awayProviderName].filter(Boolean);
    const homeScores = homeRefs.length ? homeRefs.map(ref => scoreTeamNameMatch(home, ref)) : [safeNumber(extData.homeTeamMatchConfidence, 72)];
    const awayScores = awayRefs.length ? awayRefs.map(ref => scoreTeamNameMatch(away, ref)) : [safeNumber(extData.awayTeamMatchConfidence, 72)];
    const homeConfidence = clamp(Math.max(...homeScores), 0, 100);
    const awayConfidence = clamp(Math.max(...awayScores), 0, 100);
    const confidence = round(Math.min(homeConfidence, awayConfidence), 1);
    let status = 'MATCH_OK';
    if (confidence < 55) status = 'MATCH_LOW_CONFIDENCE';
    else if (confidence < 75) status = 'MATCH_REVIEW';
    return {
        status,
        confidence,
        homeConfidence,
        awayConfidence,
        homeCanonical: canonicalTeamName(home),
        awayCanonical: canonicalTeamName(away),
        homeRefs,
        awayRefs,
        reason: status === 'MATCH_LOW_CONFIDENCE'
            ? 'Team matching debole: non usare stake operativo senza revisione alias/provider.'
            : status === 'MATCH_REVIEW'
                ? 'Team matching accettabile ma da monitorare: alias/provider non perfettamente allineati.'
                : 'Team matching coerente tra feed, storico e provider.'
    };
}

function buildDataReliabilityAudit(extData = {}) {
    const homeXgValue = strictFinite(extData.homeXg ?? extData.home_xg ?? extData.xgHome ?? extData.homeUnderstatXg);
    const awayXgValue = strictFinite(extData.awayXg ?? extData.away_xg ?? extData.xgAway ?? extData.awayUnderstatXg);
    const hasHomeXg = homeXgValue !== null;
    const hasAwayXg = awayXgValue !== null;
    const hasBothXg = hasHomeXg && hasAwayXg;
    const homeMatches = safeNumber(extData.homeMatches ?? extData.home_matches ?? extData.homeSample, 0);
    const awayMatches = safeNumber(extData.awayMatches ?? extData.away_matches ?? extData.awaySample, 0);
    const footballDataLoaded = extData.footballDataLoaded === true || extData.football_data_loaded === true || homeMatches > 0 || awayMatches > 0;
    const evidenceMode = String(extData.xgEvidenceMode || extData.xg_evidence_mode || extData.understatAuthorityStatus || extData.probabilityIntegrity?.xgEvidenceMode || '').toUpperCase();
    const previousSeasonPrior = evidenceMode.includes('PREVIOUS_SEASON_XG_PRIOR') || evidenceMode.includes('STALE_XG');
    const explicitUnderstat = !previousSeasonPrior && (
        extData.understatLoaded === true
        || extData.understat_loaded === true
        || evidenceMode.includes('REAL_XG')
        || evidenceMode.includes('CURRENT_SEASON_XG')
    );
    // R11: la presenza di due numeri/caching NON prova xG reali.
    // SourceIntelligence e' l'unica attestazione di provenienza/stagione;
    // in assenza di un report sorgente si conserva la diagnostica legacy.
    const sourceEntries = extData.sourceAudit?.sources;
    const sourceXg = Array.isArray(sourceEntries) ? sourceEntries.find(item => item.id === 'UNDERSTAT_XG') : null;
    const sourceCertified = sourceXg?.status === 'AVAILABLE' && sourceXg?.authority === 'MODEL_INPUT';
    // R11: prima della costruzione di SourceIntelligence serve la stessa prova
    // grezza: stagione, provider, source class e copertura di ENTRAMBE le squadre.
    const directCertified = ['LIVE_CERTIFIED', 'LKG_CERTIFIED'].includes(String(extData.xgProviderSourceClass || '').toUpperCase())
        && String(extData.xgProviderId || '').toUpperCase().startsWith('UNDERSTAT')
        && extData.understatSeasonEvidence?.status === 'CURRENT_SEASON_XG'
        && (extData.understatCoverage?.bothTeams === true || extData.xgCoverage?.bothTeams === true);
    const understatLoaded = explicitUnderstat && hasBothXg && (sourceXg ? sourceCertified : directCertified);
    const reliabilityMode = String(extData.reliabilityMode || extData.dataMode || extData.reliability_mode || 'BOOTSTRAP').toUpperCase();

    let score = 42;
    const reasons = [];
    if (footballDataLoaded) { score += 18; reasons.push('football-data disponibile.'); } else reasons.push('football-data non confermato.');
    if (understatLoaded) { score += 18; reasons.push('Understat/xG reale della stagione corrente disponibile.'); }
    else if (previousSeasonPrior) { score += 8; reasons.push(`Understat disponibile solo come ${evidenceMode}: autorità ridotta e shrink prudenziale.`); }
    else if (evidenceMode.includes('PROXY')) { score += 7; reasons.push(`Understat/xG reale assente: attivo ${evidenceMode}.`); }
    else reasons.push(sourceXg && !sourceCertified ? 'Understat non certificato dal registro fonti: ' + (sourceXg.status || 'MISSING') + '.' : 'Understat/xG reale assente o parziale.');
    if (hasBothXg) { score += 12; reasons.push(understatLoaded ? 'xG certificato presente per entrambe le squadre.' : 'Due valori xG/PROXY presenti, non certificati come xG reali.'); }
    if (Math.min(homeMatches, awayMatches) >= 8) { score += 10; reasons.push('Sample partite sufficiente per bootstrap.'); }
    else reasons.push('Sample partite basso o non dichiarato.');
    const clubElo = extData.clubEloEvidence || {};
    if (clubElo.available === true && clubElo.authoritative === true && safeNumber(clubElo.matchConfidence, 0) >= 80) {
        score += 8;
        reasons.push(`ClubElo fresco riconciliato 2/2 (${round(clubElo.matchConfidence, 1)}%).`);
    } else if (clubElo.available === true) {
        score += 3;
        reasons.push('ClubElo disponibile come LKG/contesto, senza piena autorità.');
    } else {
        reasons.push('ClubElo non disponibile o non riconciliato 2/2.');
    }
    if (reliabilityMode.includes('POOR') || reliabilityMode.includes('LEGACY')) score -= 18;
    if (reliabilityMode.includes('CURRENT') || reliabilityMode.includes('NEW')) score += 6;
    score = clamp(score, 0, 100);

    let status = 'DATA_RELIABLE';
    if (score < 45) status = 'DATA_FRAGILE';
    else if (evidenceMode.includes('PROXY') || evidenceMode.includes('PRIOR')) {
        status = score >= 68 ? 'DATA_RELIABLE_PROXY' : 'DATA_BOOTSTRAP_PROXY';
    } else if (!understatLoaded && score >= 68) {
        status = 'DATA_RELIABLE_NO_REAL_XG';
    } else if (score < 68) status = 'DATA_BOOTSTRAP';

    return { status, score: round(score, 1), reliabilityClass: score < 55 ? 'INATTENDIBILE' : score < 70 ? 'ATTENDIBILE' : score < 85 ? 'BUONA' : 'ALTA', footballDataLoaded, understatLoaded, hasBothXg, clubEloAvailable: clubElo.available === true, clubEloAuthoritative: clubElo.authoritative === true, homeXgValue, awayXgValue, xgEvidenceMode: evidenceMode || 'UNKNOWN', homeMatches, awayMatches, reliabilityMode, reasons };
}

function buildLineupNewsAudit(extData = {}) {
    const lineupStatus = String(extData.lineupStatus || extData.lineups_status || extData.lineupsConfirmed || '').toUpperCase();
    const homeAbsences = Number.isFinite(Number(extData.homeKeyAbsences)) ? Number(extData.homeKeyAbsences) : 0;
    const awayAbsences = Number.isFinite(Number(extData.awayKeyAbsences)) ? Number(extData.awayKeyAbsences) : 0;
    const newsConfidence = clamp(safeNumber(extData.newsConfidence ?? extData.teamNewsConfidence, 45), 0, 100);
    const lineupConfirmed = extData.lineupsConfirmed === true || lineupStatus === 'CONFIRMED' || lineupStatus === 'LINEUPS_CONFIRMED' || lineupStatus === 'TRUE';
    const probableLineup = lineupStatus.includes('PROBABLE') || lineupStatus.includes('EXPECTED');
    const totalAbsences = homeAbsences + awayAbsences;
    let risk = 32;
    const reasons = [];
    if (lineupConfirmed) { risk -= 18; reasons.push('Formazioni confermate o fonte lineup forte.'); }
    else if (probableLineup) { risk -= 6; reasons.push('Formazioni probabili: ancora da confermare.'); }
    else { risk += 14; reasons.push('Formazioni non confermate: stake pre-match da ridurre.'); }
    if (newsConfidence < 35) { risk += 16; reasons.push('News confidence bassa.'); }
    if (totalAbsences >= 3) { risk += 24; reasons.push('Molte assenze chiave dichiarate.'); }
    else if (totalAbsences > 0) { risk += 10; reasons.push('Assenze chiave presenti.'); }
    risk = clamp(risk, 0, 100);

    let status = 'LINEUP_OK';
    if (risk >= 68) status = 'LINEUP_RISK_HIGH';
    else if (!lineupConfirmed) status = 'LINEUP_NOT_CONFIRMED';
    return { status, risk: round(risk, 1), lineupConfirmed, probableLineup, newsConfidence, homeAbsences, awayAbsences, reasons };
}

function buildTimingAudit(extData = {}, now = new Date()) {
    const rawKickoff = extData.commenceTime || extData.commence_time || extData.matchDate || extData.kickoff || extData.date;
    const kickoff = rawKickoff ? new Date(rawKickoff) : null;
    let minutesToKickoff = null;
    if (kickoff && !Number.isNaN(kickoff.getTime())) minutesToKickoff = Math.round((kickoff.getTime() - now.getTime()) / 60000);
    let status = 'TIMING_UNKNOWN';
    let action = 'Solo micro/watchlist: timing partita non disponibile.';
    let risk = 35;
    if (minutesToKickoff !== null) {
        if (minutesToKickoff > 24 * 60) { status = 'EARLY_WATCHLIST'; action = 'Oltre 24h: solo watchlist, attendere news e quote più mature.'; risk = 58; }
        else if (minutesToKickoff > 120) { status = 'PRE_MATCH_EARLY'; action = '2-24h: micro/cap solo con dati completi; lineup non definitive.'; risk = 42; }
        else if (minutesToKickoff > 60) { status = 'LINEUP_WINDOW'; action = '60-120m: attendere probabili/ufficiali prima dello stake standard.'; risk = 30; }
        else if (minutesToKickoff >= 0) { status = 'FINAL_GATE'; action = 'Ultima ora: gate finale, controllare formazioni ufficiali e news.'; risk = 18; }
        else { status = 'LIVE_OR_SETTLED'; action = 'Kickoff passato: non aprire pre-match; usare solo modulo live/settlement.'; risk = 72; }
    }
    return { status, risk, minutesToKickoff, action };
}

function normalizePrediction(prediction = '') {
    return String(prediction || '').toUpperCase().replace(/\s+/g, '').replace(',', '.');
}

function buildCorrelationAudit({ prediction, probabilities = {}, odds = {}, extData = {} } = {}) {
    const p = normalizePrediction(prediction);
    const prob = key => safeNumber(probabilities[key] ?? probabilities[key.toUpperCase?.()] ?? 0, 0);
    const combos = [];
    const add = (name, level, risk, rationale, alternative) => combos.push({ name, level, risk, rationale, alternative });

    const favSide = prob('1') >= prob('2') ? '1' : '2';
    const favProb = Math.max(prob('1'), prob('2'));
    const overProb = prob('O2.5');
    const underProb = prob('U2.5');
    const goalProb = prob('GG');
    const noGoalProb = prob('NG');

    if ((p === '1' || p === '2') && overProb >= 54) {
        add(`${p} + Over 2.5`, 'MEDIA', 38, 'Segno e Over possono coesistere ma aumentano varianza goal.', `${p} secco oppure Over solo dopo ritmo live.`);
    }
    if ((p.includes('-1') || p.includes('AH-1') || p.includes('HANDICAP')) && overProb >= 54) {
        add('Favorito -1 + Over', 'ALTA', 68, 'Handicap favorito e Over descrivono scenario molto correlato.', 'Ridurre a un solo mercato primario: handicap oppure Over, non entrambi.');
    }
    if (p === 'X' && underProb >= 54) {
        add('X + Under', 'ALTA', 64, 'Pareggio e Under condividono scenario di gara bloccata.', 'Preferire X live o Under dopo 20 minuti, non doppia esposizione pre-match.');
    }
    if ((p === 'GG' || p === 'BTTS') && overProb >= 54) {
        add('Goal + Over', 'ALTA', 66, 'Goal e Over sono fortemente correlati su gara aperta.', 'Scegliere il mercato con quota/edge migliore; l’altro resta audit.');
    }
    if ((p === 'NG' || p === 'NOGOAL') && underProb >= 54) {
        add('No Goal + Under', 'ALTA', 66, 'No Goal e Under sono fortemente correlati su gara chiusa.', 'Scegliere No Goal o Under, non entrambi come stake reale.');
    }
    if (p === '1X' && favSide === '1' && favProb >= 58) {
        add('1X + favorito vincente', 'ALTA_DUPLICAZIONE', 74, 'Doppia chance e vincente casa duplicano lo stesso lato.', 'Usare 1X come protezione o 1 come value, non entrambi operativi.');
    }
    if (p === 'X2' && favSide === '2' && favProb >= 58) {
        add('X2 + favorito vincente', 'ALTA_DUPLICAZIONE', 74, 'Doppia chance e vincente ospite duplicano lo stesso lato.', 'Usare X2 come protezione o 2 come value, non entrambi operativi.');
    }

    const manual = Array.isArray(extData.correlatedMarkets) ? extData.correlatedMarkets : [];
    for (const m of manual) {
        if (m && m.name) add(String(m.name), String(m.level || 'MEDIA'), safeNumber(m.risk, 45), String(m.rationale || 'Correlazione dichiarata dal contesto.'), String(m.alternative || 'Tenere solo un mercato operativo.'));
    }

    const highestRisk = combos.reduce((max, c) => Math.max(max, safeNumber(c.risk, 0)), 0);
    let status = 'CORRELATION_OK';
    if (highestRisk >= 70) status = 'CORRELATION_DUPLICATE_OR_HIGH';
    else if (highestRisk >= 55) status = 'CORRELATION_HIGH';
    else if (highestRisk >= 30) status = 'CORRELATION_MEDIUM';

    return { status, highestRisk, combos };
}

function buildCalcioProfessionalAudit({ home, away, prediction, probabilities = {}, odds = {}, extData = {}, now = new Date() } = {}) {
    const teamMatching = buildTeamMatchingAudit({ home, away, extData });
    const dataReliability = buildDataReliabilityAudit(extData);
    const lineupNews = buildLineupNewsAudit(extData);
    const timing = buildTimingAudit(extData, now);
    const correlation = buildCorrelationAudit({ prediction, probabilities, odds, extData });

    const earlyTiming = ['EARLY_WATCHLIST', 'PRE_MATCH_EARLY'].includes(timing.status);
    // Patch 16: la normale assenza di lineup lontano dal kickoff è rischio di timing,
    // non una prova che il dato del pronostico sia scadente.
    const structuralLineupRisk = earlyTiming ? Math.min(lineupNews.risk, 35) : lineupNews.risk;
    const structuralRisk = round(Math.max(
        0.35 * structuralLineupRisk + 0.30 * (100 - dataReliability.score) + 0.20 * (100 - teamMatching.confidence) + 0.15 * correlation.highestRisk,
        teamMatching.confidence < 50 ? 82 : 0,
        correlation.highestRisk >= 74 ? 74 : 0
    ), 1);
    const risk = round(Math.max(
        structuralRisk,
        0.25 * lineupNews.risk + 0.25 * (100 - dataReliability.score) + 0.20 * (100 - teamMatching.confidence) + 0.15 * timing.risk + 0.15 * correlation.highestRisk,
        lineupNews.risk >= 78 && !earlyTiming ? 78 : 0,
        teamMatching.confidence < 50 ? 82 : 0,
        correlation.highestRisk >= 74 ? 74 : 0
    ), 1);

    const hardBlock = teamMatching.confidence < 45 || (!earlyTiming && lineupNews.risk >= 84);
    const lineupWindowRequiresBlock = ['LINEUP_WINDOW', 'FINAL_GATE'].includes(timing.status)
        && ['LINEUP_RISK_HIGH'].includes(lineupNews.status);
    const softBlock = !hardBlock && (
        structuralRisk >= 58
        || dataReliability.status === 'DATA_FRAGILE'
        || lineupWindowRequiresBlock
    );
    const watchlist = !hardBlock && !softBlock && ['EARLY_WATCHLIST', 'PRE_MATCH_EARLY'].includes(timing.status);
    const status = hardBlock
        ? 'PROFESSIONAL_BLOCK_HARD'
        : softBlock
            ? 'PROFESSIONAL_BLOCK_SOFT'
            : watchlist
                ? 'PROFESSIONAL_WATCHLIST'
                : 'PROFESSIONAL_OK';

    const recommendations = [];
    if (lineupNews.status !== 'LINEUP_OK' && ['LINEUP_WINDOW', 'FINAL_GATE'].includes(timing.status)) recommendations.push('Attendere formazioni/news ufficiali prima dello stake standard.');
    else if (lineupNews.status !== 'LINEUP_OK') recommendations.push('Lineup non ancora attese: conservare lo stake teorico e riesaminare nella finestra operativa.');
    if (dataReliability.status !== 'DATA_RELIABLE') recommendations.push('Validare xG/Understat/football-data: dati non ancora pienamente affidabili.');
    if (teamMatching.status !== 'MATCH_OK') recommendations.push('Revisionare alias squadre/provider prima del trading reale.');
    if (timing.status !== 'FINAL_GATE' && timing.status !== 'LINEUP_WINDOW') recommendations.push(timing.action);
    if (correlation.combos.length) recommendations.push('Gestire le combinazioni correlate come alternative audit, non esposizioni multiple.');
    if (!recommendations.length) recommendations.push('Profilo professionale coerente: gate operativo può valutare cap/micro secondo edge e DeepScan.');

    return {
        version: STEP60_CALCIO_PROFESSIONAL_GUARD_VERSION,
        status,
        risk,
        structuralRisk,
        riskOrigin: hardBlock ? 'HARD_VETO' : softBlock ? (dataReliability.status === 'DATA_FRAGILE' ? 'DATA' : lineupWindowRequiresBlock ? 'LINEUP_WINDOW' : 'STRUCTURAL') : watchlist ? 'TIMING_ONLY' : 'NONE',
        teamMatching,
        dataReliability,
        lineupNews,
        timing,
        correlation,
        recommendations
    };
}

function applyProfessionalRiskToClassification(classification = {}, audit = {}) {
    const current = { ...classification };
    if (!audit || !audit.status) return current;
    if (audit.status === 'PROFESSIONAL_BLOCK_HARD') {
        return {
            ...current,
            level: 'ALTO_RISCHIO',
            action: '🔴 ALTO RISCHIO',
            isHighRisk: true,
            summary: `${current.summary || ''} Guardrail professionale Calcio HARD: lineup/team matching/dati non affidabili.`.trim()
        };
    }
    if (audit.status === 'PROFESSIONAL_BLOCK_SOFT' && !['ALTO_RISCHIO'].includes(String(current.level || '').toUpperCase())) {
        return {
            ...current,
            level: 'RISCHIO_MODELLO',
            action: '🟠 RISCHIO MODELLO',
            isHighRisk: false,
            summary: `${current.summary || ''} Guardrail professionale Calcio SOFT: attendere conferme lineup/dati/timing/correlazioni.`.trim()
        };
    }
    return current;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderCalcioProfessionalAuditHtml(audit = {}) {
    if (!audit || !audit.version) return '';
    const color = audit.status === 'PROFESSIONAL_BLOCK_HARD' ? '#ef4444' : audit.status === 'PROFESSIONAL_BLOCK_SOFT' ? '#f59e0b' : '#10b981';
    const corrRows = (audit.correlation?.combos || []).slice(0, 6).map(c => `
        <div style="padding:7px 9px; border-radius:8px; background:rgba(15,23,42,0.7); border:1px solid rgba(148,163,184,0.25);">
            <strong style="color:#f8fafc;">${escapeHtml(c.name)}</strong> · <span style="color:${safeNumber(c.risk, 0) >= 60 ? '#fb7185' : '#fbbf24'}; font-weight:800;">${escapeHtml(c.level)}</span><br>
            <span style="color:#94a3b8;">${escapeHtml(c.rationale)}</span><br>
            <span style="color:#38bdf8;">Alternativa: ${escapeHtml(c.alternative)}</span>
        </div>
    `).join('') || '<span style="color:#94a3b8;">Nessuna correlazione critica rilevata.</span>';
    const recs = (audit.recommendations || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
    return `
        <div style="margin:15px 20px; padding:12px; border-radius:10px; background:rgba(2,6,23,0.72); border:1px solid ${color};">
            <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
                <div style="color:#38bdf8; font-weight:900; text-transform:uppercase;">🧭 Step60 Calcio Professional Guardrails</div>
                <div style="color:${color}; font-weight:900;">${escapeHtml(audit.status)} · Risk ${escapeHtml(audit.risk)}/100</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; color:#cbd5e1; font-size:0.8rem;">
                <div><strong>Lineup/news</strong><br>${escapeHtml(audit.lineupNews?.status)} · risk ${escapeHtml(audit.lineupNews?.risk)}</div>
                <div><strong>xG / Understat / football-data</strong><br>${escapeHtml(audit.dataReliability?.status)} · score ${escapeHtml(audit.dataReliability?.score)}</div>
                <div><strong>Team matching</strong><br>${escapeHtml(audit.teamMatching?.status)} · conf. ${escapeHtml(audit.teamMatching?.confidence)}%</div>
                <div><strong>Timing operativo</strong><br>${escapeHtml(audit.timing?.status)} · ${escapeHtml(audit.timing?.minutesToKickoff ?? 'N/D')} min</div>
            </div>
            <div style="margin-top:10px; color:#e2e8f0; font-size:0.8rem;"><strong>Combinazioni / alternative correlate</strong><div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px; margin-top:6px;">${corrRows}</div></div>
            <div style="margin-top:10px; color:#cbd5e1; font-size:0.8rem;"><strong>Azioni consigliate:</strong><ul style="margin:6px 0 0 18px; padding:0;">${recs}</ul></div>
        </div>
    `;
}

module.exports = {
    STEP60_CALCIO_PROFESSIONAL_GUARD_VERSION,
    canonicalTeamName,
    scoreTeamNameMatch,
    buildTeamMatchingAudit,
    buildDataReliabilityAudit,
    buildLineupNewsAudit,
    buildTimingAudit,
    buildCorrelationAudit,
    buildCalcioProfessionalAudit,
    applyProfessionalRiskToClassification,
    renderCalcioProfessionalAuditHtml
};
