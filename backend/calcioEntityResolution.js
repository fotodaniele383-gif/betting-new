'use strict';

const CALCIO_ENTITY_RESOLUTION_VERSION = 'BETTING_PATCH_26F_B_ENTITY_RESOLUTION_V2';

const TEAM_SCOPE = Object.freeze({
    MEN_FIRST_TEAM: 'MEN_FIRST_TEAM',
    WOMEN: 'WOMEN',
    U21: 'U21',
    U18: 'U18',
    ACADEMY: 'ACADEMY',
    RESERVES: 'RESERVES',
    OTHER: 'OTHER',
    UNKNOWN: 'UNKNOWN'
});

const TEAM_ALIASES = Object.freeze({
    'manchester city': ['man city', 'manchester city fc'],
    'manchester united': ['man united', 'man utd', 'manchester united fc'],
    'tottenham hotspur': ['tottenham', 'spurs'],
    'newcastle united': ['newcastle'],
    'nottingham forest': ["nott'm forest", 'nottm forest'],
    'wolverhampton wanderers': ['wolves', 'wolverhampton'],
    'brighton and hove albion': ['brighton'],
    'west ham united': ['west ham'],
    'crystal palace': ['palace'],
    'paris saint germain': ['paris sg', 'psg'],
    'atletico madrid': ['ath madrid', 'atletico'],
    'athletic bilbao': ['ath bilbao', 'athletic club'],
    'borussia dortmund': ['dortmund'],
    'bayer leverkusen': ['leverkusen'],
    'eintracht frankfurt': ['ein frankfurt'],
    'borussia monchengladbach': ["m'gladbach", 'monchengladbach', 'gladbach'],
    'fc koln': ['koln', 'cologne'],
    'inter milan': ['inter', 'internazionale', 'fc internazionale milano'],
    'ac milan': ['milan', 'milan fc'],
    'as roma': ['roma', 'roma fc'],
    'atalanta': ['atalanta bc', 'atalanta bergamo'],
    'hellas verona': ['verona'],
    'genoa': ['genoa cfc'],
    'napoli': ['ssc napoli', 'naples'],
    'torino': ['torino fc'],
    'fiorentina': ['acf fiorentina'],
    'bologna': ['bologna fc'],
    'lazio': ['ss lazio'],
    'udinese': ['udinese calcio'],
    'parma': ['parma calcio'],
    'cagliari': ['cagliari calcio'],
    'como': ['como 1907'],
    'lecce': ['us lecce'],
    'sassuolo': ['us sassuolo'],
    'monza': ['ac monza'],
    'venezia': ['venezia fc'],
    'frosinone': ['frosinone calcio'],
    'juventus': ['juventus fc', 'juve'],
    'cremonese': ['us cremonese'],
    'pisa': ['pisa sc'],
    'empoli': ['empoli fc'],
    'sampdoria': ['uc sampdoria'],
    'spezia': ['spezia calcio'],
    'palermo': ['palermo fc']
});

const KNOWN_SQUAD_ENTITIES = Object.freeze({
    'my cato': Object.freeze({ team: 'Crystal Palace', scope: TEAM_SCOPE.WOMEN, source: 'PATCH7_KNOWN_SQUAD_ENTITY' })
});

const WOMEN_PATTERNS = Object.freeze([
    /\bwomen(?:'s|s)?\b/i,
    /\bladies\b/i,
    /\bwsl\b/i,
    /\bwsl\s?2\b/i,
    /\bbarclays women/i,
    /\/women(?:\/|\b)/i,
    /\bwomens team\b/i
]);

const U21_PATTERNS = Object.freeze([
    /\bu\s?21(?:s|'s)?\b/i,
    /\bunder[-\s]?21(?:s|'s)?\b/i,
    /\bpremier league 2\b/i,
    /\bpl2\b/i,
    /\byoung eagles\b/i,
    /\/under[-_]?21s?(?:\/|\b)/i
]);

const U18_PATTERNS = Object.freeze([
    /\bu\s?18(?:s|'s)?\b/i,
    /\bunder[-\s]?18(?:s|'s)?\b/i,
    /\/under[-_]?18s?(?:\/|\b)/i
]);

const ACADEMY_PATTERNS = Object.freeze([
    /\bacademy\b/i,
    /\byouth team\b/i,
    /\byouth cup\b/i,
    /\/academy(?:\/|\b)/i,
    /\bdevelopment squad\b/i
]);

const RESERVE_PATTERNS = Object.freeze([
    /\breserves?\b/i,
    /\bb team\b/i,
    /\bsecond team\b/i
]);

function normalizeText(value = '') {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function canonicalTeamName(value = '') {
    return normalizeText(value)
        .replace(/^the\s+/, '')
        .replace(/\b(fc|cf|afc|cfc|ssc|ac|as|bc|ss|us|uc|sc|calcio)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a = '', b = '') {
    const left = String(a);
    const right = String(b);
    const rows = right.length + 1;
    const cols = left.length + 1;
    const matrix = Array.from({ length: rows }, (_, i) => {
        const row = new Array(cols).fill(0);
        row[0] = i;
        return row;
    });
    for (let j = 0; j < cols; j++) matrix[0][j] = j;
    for (let i = 1; i < rows; i++) {
        for (let j = 1; j < cols; j++) {
            matrix[i][j] = right[i - 1] === left[j - 1]
                ? matrix[i - 1][j - 1]
                : Math.min(matrix[i - 1][j - 1], matrix[i][j - 1], matrix[i - 1][j]) + 1;
        }
    }
    return matrix[right.length][left.length];
}

function aliasSet(teamName = '') {
    const canonical = canonicalTeamName(teamName);
    const aliases = new Set([canonical]);
    for (const [main, values] of Object.entries(TEAM_ALIASES)) {
        const normalizedMain = canonicalTeamName(main);
        const normalizedValues = values.map(canonicalTeamName);
        if (canonical === normalizedMain || normalizedValues.includes(canonical)) {
            aliases.add(normalizedMain);
            normalizedValues.forEach(alias => aliases.add(alias));
        }
    }
    return aliases;
}

function tokenSimilarity(a = '', b = '') {
    const aa = new Set(canonicalTeamName(a).split(/\s+/).filter(Boolean));
    const bb = new Set(canonicalTeamName(b).split(/\s+/).filter(Boolean));
    if (!aa.size || !bb.size) return 0;
    let overlap = 0;
    for (const token of aa) if (bb.has(token)) overlap++;
    return overlap / Math.max(aa.size, bb.size);
}

function resolveTeamName(teamName = '', candidates = [], options = {}) {
    const requested = canonicalTeamName(teamName);
    const safeCandidates = (Array.isArray(candidates) ? candidates : [])
        .map(value => String(value || '').trim())
        .filter(Boolean);
    if (!requested || !safeCandidates.length) {
        return { matched: false, requested: teamName, canonicalRequested: requested, resolved: null, confidence: 0, method: 'NO_CANDIDATES' };
    }

    const requestedAliases = aliasSet(requested);
    for (const candidate of safeCandidates) {
        const canonicalCandidate = canonicalTeamName(candidate);
        if (requestedAliases.has(canonicalCandidate) || aliasSet(candidate).has(requested)) {
            return { matched: true, requested: teamName, canonicalRequested: requested, resolved: candidate, confidence: 1, method: 'EXACT_OR_ALIAS' };
        }
    }

    let best = null;
    for (const candidate of safeCandidates) {
        const canonicalCandidate = canonicalTeamName(candidate);
        const distance = levenshtein(requested, canonicalCandidate);
        const maxLength = Math.max(requested.length, canonicalCandidate.length, 1);
        const editSimilarity = 1 - distance / maxLength;
        const tokens = tokenSimilarity(requested, canonicalCandidate);
        const score = Math.max(editSimilarity, tokens * 0.96);
        if (!best || score > best.score) best = { candidate, score, editSimilarity, tokens };
    }
    const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 0.82;
    if (best && best.score >= threshold) {
        return {
            matched: true,
            requested: teamName,
            canonicalRequested: requested,
            resolved: best.candidate,
            confidence: Number(best.score.toFixed(4)),
            method: best.tokens >= best.editSimilarity ? 'TOKEN_SIMILARITY' : 'EDIT_SIMILARITY'
        };
    }
    return {
        matched: false,
        requested: teamName,
        canonicalRequested: requested,
        resolved: null,
        confidence: best ? Number(best.score.toFixed(4)) : 0,
        method: 'NO_CONSERVATIVE_MATCH',
        closest: best ? best.candidate : null
    };
}

function extractKnownEntity(text = '') {
    const normalized = normalizeText(text);
    for (const [name, resolution] of Object.entries(KNOWN_SQUAD_ENTITIES)) {
        if (normalized.includes(name)) return { name, ...resolution };
    }
    return null;
}

function classifyEvidenceScope(article = {}) {
    const raw = [article.title, article.originalTitle, article.fullText, article.sourceUrl, article.link].filter(Boolean).join(' ');
    const knownEntity = extractKnownEntity(raw);
    if (knownEntity) {
        return {
            scope: knownEntity.scope,
            reason: knownEntity.scope === TEAM_SCOPE.WOMEN ? 'KNOWN_WOMEN_PLAYER' : 'KNOWN_NON_FIRST_TEAM_ENTITY',
            subjectResolution: knownEntity
        };
    }
    if (WOMEN_PATTERNS.some(pattern => pattern.test(raw))) return { scope: TEAM_SCOPE.WOMEN, reason: 'WOMEN_CONTENT', subjectResolution: null };
    if (U21_PATTERNS.some(pattern => pattern.test(raw))) return { scope: TEAM_SCOPE.U21, reason: 'U21_CONTENT', subjectResolution: null };
    if (U18_PATTERNS.some(pattern => pattern.test(raw))) return { scope: TEAM_SCOPE.U18, reason: 'U18_CONTENT', subjectResolution: null };
    if (ACADEMY_PATTERNS.some(pattern => pattern.test(raw))) return { scope: TEAM_SCOPE.ACADEMY, reason: 'ACADEMY_CONTENT', subjectResolution: null };
    if (RESERVE_PATTERNS.some(pattern => pattern.test(raw))) return { scope: TEAM_SCOPE.RESERVES, reason: 'RESERVE_CONTENT', subjectResolution: null };
    return { scope: TEAM_SCOPE.MEN_FIRST_TEAM, reason: null, subjectResolution: null };
}

function canonicalPublisher(article = {}) {
    const sourceUrl = String(article.sourceUrl || '');
    try {
        if (sourceUrl) return new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_) {}
    const sourceName = normalizeText(article.sourceName || 'unknown');
    return sourceName || 'unknown';
}

function normalizeHeadline(title = '') {
    return normalizeText(title)
        .replace(/\b(everton fc|crystal palace f c|bbc|sky sports|the guardian|reuters|yahoo sports canada|flashscore com)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function publicationDay(article = {}) {
    const value = article.publishedAt || article.pubDate;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : 'unknown-date';
}

function evidenceFingerprint(article = {}) {
    const title = normalizeHeadline(article.originalTitle || article.title || '');
    const publisher = canonicalPublisher(article);
    const day = publicationDay(article);
    const category = normalizeText(article.category || 'other');
    return [title, publisher, day, category].join('|');
}

function clusterEvidence(articles = []) {
    const clusters = new Map();
    for (const article of Array.isArray(articles) ? articles : []) {
        const fingerprint = evidenceFingerprint(article);
        const existing = clusters.get(fingerprint);
        const providerId = article.providerId || 'UNKNOWN_PROVIDER';
        if (!existing) {
            clusters.set(fingerprint, {
                fingerprint,
                primary: article,
                retrievalPaths: [providerId],
                duplicateCount: 0,
                publishers: [canonicalPublisher(article)]
            });
            continue;
        }
        if (!existing.retrievalPaths.includes(providerId)) existing.retrievalPaths.push(providerId);
        const publisher = canonicalPublisher(article);
        if (!existing.publishers.includes(publisher)) existing.publishers.push(publisher);
        existing.duplicateCount++;
        const currentTrust = Number(existing.primary.trustWeight || 0);
        const candidateTrust = Number(article.trustWeight || 0);
        if (candidateTrust > currentTrust) existing.primary = article;
    }
    return [...clusters.values()];
}

module.exports = {
    CALCIO_ENTITY_RESOLUTION_VERSION,
    TEAM_SCOPE,
    TEAM_ALIASES,
    KNOWN_SQUAD_ENTITIES,
    normalizeText,
    canonicalTeamName,
    resolveTeamName,
    classifyEvidenceScope,
    canonicalPublisher,
    evidenceFingerprint,
    clusterEvidence
};
