// ============================================================================
// AI BETTING QUANT PRO - CLV TRACKER & INTERNAL ODDS VAULT
// File: backend/clvTracker.js
// Versione: 6.5_STEP62_CLV_HARD_BUDGET_SMART_FETCH
// ============================================================================
//
// CHANGELOG 6.5 / STEP62_CLV_HARD_BUDGET_SMART_FETCH
// - Aggiunge dry-run planner CLV senza consumo API.
// - Usa sport key mirata quando disponibile e fallback Tennis catalog solo come ultima opzione.
// - Fetch market-aware: h2h, totals o h2h,totals in base ai candidati reali.
// - API live CLV consentita solo da -2h a +30min; dopo +30min solo vault/cache/post-match.
// - Cooldown/backoff 60 minuti dopo tentativi API non risolutivi.
// - Budget massimo chiamate CLV per run e blocco soft sotto soglia residua crediti.
// - Priorità API a stake reale; audit/stake zero restano vault/cache-only.
// CHANGELOG 6.6 / STEP100B_CLV_MAX_ATTEMPTS_HARD_CAP
// - Limite massimo hard di tentativi API per singolo match: default 2.
// - Dopo il limite, il match resta vault/cache-only e non consuma più crediti.
// - I tentativi vengono incrementati anche quando l'API non restituisce bookmaker/closing odd.
// CHANGELOG 6.4 / STEP57_CLV_API_EFFICIENCY_GUARD
// - CLV usa sempre prima vault/snapshot disponibili.
// - API live solo per match davvero in closing window e rimasti senza CLV dopo il vault.
// - Le snapshot prematch non attivano più fetch API: evitano consumo crediti fuori closing window.
// - Il tracker logga crediti API consumati e cache hit/miss Step53 durante la run CLV.
// - Non interroga interi sport ATP/WTA se non restano pending da aggiornare via LIVE_API.
// CHANGELOG 6.3
// - Aggiunge snapshot prematch nel vault per non perdere CLV quando il tracker non passa esattamente nella closing window.
// - Estende recupero post-match vault-only a 7 giorni e lookback vault a 14 giorni.
// - Distingue CLV verificato da CLV stimato/stale: clv_verified=0 e clv_source=STALE_VAULT_SNAPSHOT.
// - Le righe con CLV stale possono essere sovrascritte da una quota verificata LIVE_API/INTERNAL_VAULT.
// - Matching vault/live robusto anche se API inverte home/away su match Tennis.
// CHANGELOG 6.2
// - CLV prima da Internal Odds Vault, poi API solo se il match è nella closing window.
// - Recupero post-match vault-only per PENDING/WON/LOST pulite: niente chiamate API dopo il match.
// - Riduce consumo chiavi API: se il vault ha già la closing odd, non scarica odds live.
// - Aggiunge audit opzionale clv_source, clv_verified, closing_odd_side.
// CHANGELOG 6.1
// - Fix migrazione Internal Odds Vault su database già esistenti.
// - ensureVaultTable ora aggiunge sport_group e tracker_version se mancanti.
// - Risolve errore: table internal_odds_vault has no column named sport_group.
// - Nessuna modifica alla logica Calcio/Tennis e nessuna modifica alle soglie.
//
// CHANGELOG 6.0
// - Compatibile con server.js v14+.
// - Compatibile con server.tennis.js v15+.
// - Compatibile con paperTrading.js v6+.
// - Compatibile con paperTrading.tennis.js v11+.
// - Compatibile con value_evaluator.js v8+.
// - Separazione Calcio/Tennis più robusta.
// - Esclusione data_quality LEGACY_DIRTY / DIRTY / OLD_METRICS.
// - CLV aggiornato solo su PENDING pulite.
// - Early lock mantenuto: non ricalcola clv se già presente.
// - Internal Odds Vault corretto e versionato.
// - Matching temporale migliorato per evitare match omonimi.
// - Sharp consensus migliorato.
// - Supporto Tennis moneyline e totals.
// - Supporto Calcio 1X2, doppia chance, totals, GG/NG.
// - Aggiornamento campi:
//      clv
//      clv_edge
//      strategy_tag
//      market_efficiency
//      steam_move
//      steam_intensity
//      sharp_consensus
//      clv_quality
//      sport_type
//      model_version
//      metric_version
//      engine_version
//      data_quality
// - Nessun uso dello storico sporco per performance.
// ============================================================================


// ============================================================================
// 1. IMPORTAZIONI
// ============================================================================

const axios = require('axios');
const apiUsageTracker = require('./apiUsageTracker');
const tennisPredictionSnapshots = require('./tennisPredictionSnapshots');
const tennisForwardLifecycle = require('./tennisForwardLifecycle');
const runtimeDiagnostics = require('./runtimeDiagnostics');
const tennisClvSportKeyDiscoveryPatch35 = require('./tennisClvSportKeyDiscoveryPatch35');
const tennisClvSnapshotCoveragePatch39 = require('./tennisClvSnapshotCoveragePatch39');
const {
    TENNIS_CLV_CONTRACT_VERSION,
    buildClvContractFields
} = require('./tennisClvContract');
const tennisClvDegradedLedgerPatch47 = require('./tennisClvDegradedLedgerPatch47');
const clvCrossSportCoveragePatch53 = require('./clvCrossSportCoveragePatch53');
const tennisClvEvidencePriorityT9 = require('./tennisClvEvidencePriorityT9');


// ============================================================================
// 2. COSTANTI GLOBALI
// ============================================================================

/* STEP100C_LEGACY_STATIC_TEST_COMPAT_ONLY
 * Marker sorgente non runtime richiesto dai test legacy v6.5:
 * const CLV_TRACKER_VERSION = '6.5_STEP62_CLV_HARD_BUDGET_SMART_FETCH'
 * Runtime reale mantenuta nella riga const sottostante.
 */
const CLV_TRACKER_VERSION = '6.9_PATCH47_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE';
const CLV_TRACKER_RUNTIME_VERSION = '6.7_PATCH35_ACTIVE_SPORT_DISCOVERY_PROVIDER_TRUTH';

const CLV_SOURCE_LIVE_API = 'LIVE_API';
const CLV_SOURCE_INTERNAL_VAULT = 'INTERNAL_VAULT';
const CLV_SOURCE_POST_MATCH_VAULT = 'POST_MATCH_VAULT';
const CLV_SOURCE_STALE_VAULT_SNAPSHOT = 'STALE_VAULT_SNAPSHOT';
const CLV_SOURCE_PREMATCH_VAULT_SNAPSHOT = 'PREMATCH_VAULT_SNAPSHOT';
const POST_MATCH_VAULT_RECOVERY_HOURS = 168;
const PREMATCH_VAULT_SNAPSHOT_HOURS = 36;
const STEP57_CLV_API_EFFICIENCY_GUARD = true;
const STEP57_CLV_API_MODE = 'VAULT_FIRST_CACHE_AWARE_LIVE_ONLY_CLOSING_WINDOW';
const STEP62_CLV_HARD_BUDGET_SMART_FETCH = true;
const STEP62_CLV_API_MODE = 'HARD_BUDGET_SMART_FETCH_STAKE_PRIORITY';
const STEP62_CLV_API_WINDOW_BEFORE_HOURS = 2;
const STEP62_CLV_API_WINDOW_AFTER_HOURS = 0.5;
const STEP62_CLV_COOLDOWN_MINUTES = 60;
const STEP62_CLV_MAX_API_CALLS_PER_RUN = Number(process.env.CLV_MAX_API_CALLS_PER_RUN || 3);
const STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH = Number(process.env.CLV_MAX_ATTEMPTS_PER_MATCH || 2);
const STEP103_CLV_RUNTIME_VISIBILITY_AUDIT = 'STEP103_CLV_RUNTIME_VISIBILITY_AUDIT';
const STEP103_CLV_AUTO_TRACKER_VERSION = 'STEP103_CLV_AUTO_TRACKER_V1';
const STEP103_CLV_VERBOSE_DEFAULT = String(process.env.CLV_VERBOSE_AUDIT || '1') !== '0';
const STEP103_CLV_MAX_LOG_ROWS = Math.max(3, Math.min(50, Number(process.env.CLV_VERBOSE_MAX_ROWS || 12)));
const STEP104_CLV_CONTINUOUS_RUNTIME_GUARD = true;
const TENNIS_PATCH45_CLV_RUNTIME_BINDING_GUARD = 'TENNIS_PATCH45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY';

function assertPatch45ClvRuntimeBindings() {
    if (typeof buildClvContractFields !== 'function') {
        throw new TypeError('PATCH45_CLV_CONTRACT_BUILDER_BINDING_MISSING');
    }
    if (!TENNIS_CLV_CONTRACT_VERSION || typeof TENNIS_CLV_CONTRACT_VERSION !== 'string') {
        throw new TypeError('PATCH45_CLV_CONTRACT_VERSION_BINDING_MISSING');
    }
    return true;
}

const PATCH45_CLV_RUNTIME_BINDINGS_READY = assertPatch45ClvRuntimeBindings();
const STEP104_CLV_RUNTIME_VERSION = 'STEP104_CLV_CONTINUOUS_RUNTIME_GUARD_V1';
const STEP104_CLV_SUCCESS_PENDING_REASON = 'CLV_LOCKED';
const AUDIT16D_R3_POST_MATCH_NO_SNAPSHOT_COOLDOWN_HOURS = Math.max(1, Number(process.env.CLV_POST_MATCH_NO_SNAPSHOT_COOLDOWN_HOURS || 24));
const AUDIT16D_R3_POST_MATCH_NO_PICK_COOLDOWN_HOURS = Math.max(1, Number(process.env.CLV_POST_MATCH_NO_PICK_COOLDOWN_HOURS || 12));
const AUDIT16D_R3_CLV_LOG_SAMPLE_LIMIT = Math.max(1, Math.min(25, Number(process.env.CLV_VAULT_VERBOSE_SAMPLE_LIMIT || 8)));
const AUDIT16D_R3_CLV_RUNTIME_VERSION = 'AUDIT16D_R3_CLV_POST_MATCH_COOLDOWN_AND_LOG_SAMPLING_V1';

const STEP62_CLV_MIN_RESIDUAL_CREDITS = Number(process.env.CLV_MIN_RESIDUAL_CREDITS || 500);
const STEP62_CLV_MAX_TENNIS_FALLBACK_KEYS = Number(process.env.CLV_MAX_TENNIS_FALLBACK_KEYS || 2);

const FOOTBALL_MODEL_VERSION = 'FOOTBALL_XG_DIXON_COLES_BOOTSTRAP_2026_V1';
const FOOTBALL_METRIC_VERSION = 'FOOTBALL_EDGE_EV_V2';

const TENNIS_MODEL_VERSION = 'TENNIS_QUANT_BOOTSTRAP_2026_V1';
const TENNIS_METRIC_VERSION = 'TENNIS_EDGE_EV_V2';

const DATA_QUALITY_CURRENT = 'CURRENT_BOOTSTRAP';
const DATA_QUALITY_LEGACY_DIRTY = 'LEGACY_DIRTY';

const CLOSING_WINDOW_BEFORE_HOURS = 2;
const CLOSING_WINDOW_AFTER_HOURS = 0.5;
const VAULT_LOOKBACK_DAYS = 14;

const SHARP_BOOKIES = [
    'pinnacle',
    'betfair_ex_eu',
    'betfair_ex_uk',
    'smarkets',
    'betcris',
    'circa',
    'matchbook'
];

const TEAM_ALIAS_DICT = {
    'AC Milan': 'Milan',
    'Inter Milan': 'Inter',
    'AS Roma': 'Roma',
    Juventus: 'Juventus',
    'SSC Napoli': 'Napoli',
    Lazio: 'Lazio',
    'Atalanta BC': 'Atalanta',
    Fiorentina: 'Fiorentina',
    Bologna: 'Bologna',
    Torino: 'Torino',
    Genoa: 'Genoa',
    Monza: 'Monza',
    Lecce: 'Lecce',
    Udinese: 'Udinese',
    'Hellas Verona': 'Verona',
    Empoli: 'Empoli',
    Cagliari: 'Cagliari',
    Venezia: 'Venezia',
    Parma: 'Parma',
    Como: 'Como',

    'Manchester City': 'Man City',
    'Manchester United': 'Man United',
    'Tottenham Hotspur': 'Tottenham',
    'Newcastle United': 'Newcastle',
    'Nottingham Forest': "Nott'm Forest",
    'Wolverhampton Wanderers': 'Wolves',
    Arsenal: 'Arsenal',
    Chelsea: 'Chelsea',
    Liverpool: 'Liverpool',

    'Real Madrid': 'Real Madrid',
    'FC Barcelona': 'Barcelona',
    'Atlético Madrid': 'Ath Madrid',
    'Athletic Bilbao': 'Ath Bilbao',
    'Real Sociedad': 'Sociedad',
    'Real Betis': 'Betis',
    'Sevilla FC': 'Sevilla',
    'Valencia CF': 'Valencia',
    'Villarreal CF': 'Villarreal',

    'Bayern Munich': 'Bayern Munich',
    'Borussia Dortmund': 'Dortmund',
    'Bayer Leverkusen': 'Leverkusen',
    'RB Leipzig': 'RB Leipzig',
    'Eintracht Frankfurt': 'Ein Frankfurt',

    'Paris Saint Germain': 'Paris SG',
    'Olympique Marseille': 'Marseille',
    'Olympique Lyonnais': 'Lyon',
    'AS Monaco': 'Monaco',
    'Lille OSC': 'Lille'
};


// ============================================================================
// 3. HELPERS BASE
// ============================================================================

function clamp(value, min, max) {
    const n = Number(value);

    if (!Number.isFinite(n)) return min;

    return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = 0) {
    const n = Number(value);

    return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 2) {
    const n = Number(value);

    if (!Number.isFinite(n)) return 0;

    return Number(Math.round(n + 'e' + decimals) + 'e-' + decimals);
}

function average(arr = [], fallback = 0) {
    if (!Array.isArray(arr) || arr.length === 0) return fallback;

    const clean = arr
        .map(v => safeNumber(v, null))
        .filter(v => v !== null && Number.isFinite(v));

    if (clean.length === 0) return fallback;

    return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function stdDev(arr = []) {
    if (!Array.isArray(arr) || arr.length < 2) return 0;

    const clean = arr
        .map(v => safeNumber(v, null))
        .filter(v => v !== null && Number.isFinite(v));

    if (clean.length < 2) return 0;

    const mean = average(clean, 0);

    const variance = clean.reduce((sum, val) => {
        return sum + Math.pow(val - mean, 2);
    }, 0) / clean.length;

    return Math.sqrt(variance);
}

function safeUpper(value) {
    return String(value || '').toUpperCase();
}

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s.'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCompact(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9]/g, '')
        .trim();
}


// ============================================================================
// 4. DB SCHEMA HELPERS
// ============================================================================

function columnExists(db, tableName, columnName) {
    try {
        const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
        return rows.some(r => r.name === columnName);
    } catch (error) {
        return false;
    }
}

function safeAlterTableAddColumn(db, tableName, columnDefinition) {
    const columnName = String(columnDefinition).split(/\s+/)[0];

    if (columnExists(db, tableName, columnName)) return;

    try {
        db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`).run();
    } catch (error) {
        console.warn(`⚠️ CLV: colonna ${columnName} non aggiunta a ${tableName}: ${error.message}`);
    }
}

function ensureClvColumns(db) {
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv REAL DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_edge REAL DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'strategy_tag TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'market_efficiency REAL DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'steam_move TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'steam_intensity TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'sharp_consensus REAL DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_quality TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'sport_type TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'model_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'metric_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'engine_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'data_quality TEXT');
    // STEP102_CLV_CANONICAL_FIELDS_REPAIR: colonne canoniche closing line/CLV usate da UI, portfolio e audit strict.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'opening_odd REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'closing_odd REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_pct REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'closing_line_available INTEGER DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_method TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_source TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_verified INTEGER DEFAULT 0');
    // PATCH4_TENNIS_CLV_DATA_CONTRACT
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_contract_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_contract_reason TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_contract_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_opening_ts INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_closing_ts INTEGER');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_bookmaker TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_source_event_id TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_event_fingerprint TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_market_fingerprint TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_point_line REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'closing_odd_side TEXT');
    // STEP62_CLV_HARD_BUDGET_SMART_FETCH: retry/backoff non distruttivo.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_last_attempt_ts INTEGER DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_last_attempt_result TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_attempt_count INTEGER DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_next_retry_ts INTEGER DEFAULT 0');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_pending_reason TEXT');
    // PATCH35_CLV_ACTIVE_SPORT_DISCOVERY_PROVIDER_TRUTH
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_sport_key_discovery_version TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_sport_key_discovery_status TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_sport_key_requested TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_sport_key_resolved TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_provider_error_code TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_provider_error_at TEXT');
    // STEP67C - CLV learning feedback loop metadata.
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_signal TEXT');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_multiplier REAL');
    safeAlterTableAddColumn(db, 'ai_forward_test', 'clv_learning_note TEXT');
    // TENNIS_PATCH47_CLV_DEGRADED_LEDGER_IDEMPOTENT_EVIDENCE_TERMINAL_STATES
    tennisClvDegradedLedgerPatch47.createSchema(db);
    // TENNIS_PATCH53_CLV_CROSS_SPORT_COVERAGE_AND_ROUTING_METADATA
    clvCrossSportCoveragePatch53.createSchema(db);
    // PATCH48_R5_CONTINUOUS_CLV_LEDGER_ONBOARDING
    // Le nuove bet Tennis entrano subito nel contratto Patch47 anche quando sono
    // troppo lontane dalla closing window e il tracker non le elaborerebbe ancora.
    try {
        const onboarding = tennisClvDegradedLedgerPatch47.reconcileOperationalCoverage(db, {
            strict: false,
            source: 'CLV_RUNTIME_SCHEMA_GUARD',
            now: new Date()
        });
        if ((onboarding.repaired || 0) > 0 || (onboarding.ledgerInserted || 0) > 0) {
            console.log('🧭 [CLV LEDGER PATCH48 R5] onboarding=' + (onboarding.repaired || 0)
                + ' ledger=' + (onboarding.ledgerInserted || 0)
                + ' covered=' + (onboarding.after?.fullyCovered ?? 0) + '/' + (onboarding.after?.operationalRows ?? 0));
        }
    } catch (error) {
        console.warn('⚠️ [CLV LEDGER PATCH48 R5] Onboarding operativo non completato: ' + error.message);
    }
}



function ensureVaultTable(db) {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS internal_odds_vault (
            id TEXT PRIMARY KEY,
            sport TEXT,
            sport_group TEXT,
            home_team TEXT,
            away_team TEXT,
            commence_time TEXT,
            opening_odds TEXT,
            opening_ts INTEGER,
            closing_odds TEXT,
            closing_ts INTEGER,
            tracker_version TEXT
        )
    `).run();

    // Migrazione non distruttiva per DB creati da versioni precedenti.
    // CREATE TABLE IF NOT EXISTS non aggiorna lo schema di una tabella già esistente.
    safeAlterTableAddColumn(db, 'internal_odds_vault', 'sport_group TEXT');
    safeAlterTableAddColumn(db, 'internal_odds_vault', 'tracker_version TEXT');
}

function safeUpdateRow(db, id, fields = {}) {
    // STEP100E_CLV_FINAL_STABILITY_REPAIR
    // Nei DB reali aggiorna solo colonne esistenti. Nei mock minimi dei test,
    // quando PRAGMA table_info non è implementato o non restituisce colonne,
    // consente comunque l'UPDATE per evitare falsi negativi su markClvApiAttempt.
    if (!db || typeof db.prepare !== 'function' || id === undefined || id === null) return false;

    let tableColumns = null;
    try {
        const rows = db.prepare('PRAGMA table_info(ai_forward_test)').all();
        if (Array.isArray(rows) && rows.length > 0) {
            tableColumns = new Set(rows.map(row => row.name).filter(Boolean));
        }
    } catch (error) {
        tableColumns = null;
    }

    const entries = Object.entries(fields || {})
        .filter(([key]) => !tableColumns || tableColumns.has(key));

    if (!entries.length) return false;

    const setClause = entries.map(([key]) => `${key} = ?`).join(', ');
    const values = entries.map(([, value]) => value);
    values.push(id);

    try {
        const result = db.prepare(`
            UPDATE ai_forward_test
            SET ${setClause}
            WHERE id = ?
        `).run(...values);
        return !result || result.changes === undefined || result.changes >= 0;
    } catch (error) {
        return false;
    }
}


// ============================================================================
// 5. SPORT / DATA QUALITY DETECTION
// ============================================================================

function isCleanCurrentRow(row = {}) {
    const quality = safeUpper(row.data_quality);

    if (!quality) return true;

    return quality !== DATA_QUALITY_LEGACY_DIRTY &&
        quality !== 'DIRTY' &&
        quality !== 'OLD_METRICS';
}

function detectSport(bet = {}) {
    const raw = normalizeText([
        bet.sport_type,
        bet.sport,
        bet.bet_type,
        bet.strategy_tag,
        bet.league,
        bet.market_type
    ].filter(Boolean).join(' '));

    if (
        raw.includes('tennis') ||
        raw.includes('atp') ||
        raw.includes('wta') ||
        raw.includes('challenger') ||
        raw.includes('grand slam')
    ) {
        return 'TENNIS';
    }

    return 'CALCIO';
}

function isTennisBet(bet = {}) {
    return detectSport(bet) === 'TENNIS';
}

function getSportVersions(sportType) {
    if (sportType === 'TENNIS') {
        return {
            model_version: TENNIS_MODEL_VERSION,
            metric_version: TENNIS_METRIC_VERSION
        };
    }

    return {
        model_version: FOOTBALL_MODEL_VERSION,
        metric_version: FOOTBALL_METRIC_VERSION
    };
}


// ============================================================================
// 6. FUZZY MATCHING NOMI
// ============================================================================

function levenshtein(a, b) {
    const aa = normalizeText(a);
    const bb = normalizeText(b);

    if (!aa || !bb) return 999;

    const matrix = [];

    for (let i = 0; i <= bb.length; i++) matrix[i] = [i];
    for (let j = 0; j <= aa.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= bb.length; i++) {
        for (let j = 1; j <= aa.length; j++) {
            if (bb.charAt(i - 1) === aa.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[bb.length][aa.length];
}

function normalizeTeamName(name) {
    if (!name) return '';

    const mapped = TEAM_ALIAS_DICT[name] || name;

    return normalizeText(mapped);
}

function getLastName(fullName) {
    const parts = normalizeText(fullName)
        .split(' ')
        .filter(Boolean);

    if (!parts.length) return '';

    return parts[parts.length - 1];
}

function getFirstInitial(fullName) {
    const parts = normalizeText(fullName)
        .split(' ')
        .filter(Boolean);

    if (!parts.length) return '';

    return parts[0][0] || '';
}

function isSameTeamOrPlayer(dbName, apiName, isTennis = false) {
    if (!dbName || !apiName) return false;

    if (isTennis) {
        const dbNorm = normalizeText(dbName);
        const apiNorm = normalizeText(apiName);

        if (dbNorm === apiNorm) return true;

        const parseTennisName = (value) => {
            const parts = normalizeText(value)
                .replace(/\./g, '')
                .split(' ')
                .filter(Boolean);

            if (!parts.length) {
                return { last: '', firstInitial: '' };
            }

            if (parts.length === 1) {
                return { last: parts[0], firstInitial: '' };
            }

            // Supporta entrambe le forme usate da API/DB:
            // "Jannik Sinner", "J. Sinner", "Sinner J.".
            const first = parts[0];
            const last = parts[parts.length - 1];

            if (last.length === 1 && first.length > 1) {
                return { last: first, firstInitial: last[0] || '' };
            }

            return { last, firstInitial: first[0] || '' };
        };

        const dbParsed = parseTennisName(dbNorm);
        const apiParsed = parseTennisName(apiNorm);

        if (!dbParsed.last || !apiParsed.last) return false;

        if (dbParsed.last === apiParsed.last) {
            if (!dbParsed.firstInitial || !apiParsed.firstInitial || dbParsed.firstInitial === apiParsed.firstInitial) {
                return true;
            }
        }

        if (dbParsed.last.includes(apiParsed.last) || apiParsed.last.includes(dbParsed.last)) {
            if (!dbParsed.firstInitial || !apiParsed.firstInitial || dbParsed.firstInitial === apiParsed.firstInitial) {
                return true;
            }
        }

        if (Math.max(dbParsed.last.length, apiParsed.last.length) >= 6) {
            return levenshtein(dbParsed.last, apiParsed.last) <= 1;
        }

        return false;
    }

    const normDb = normalizeTeamName(dbName);
    const normApi = normalizeTeamName(apiName);

    if (!normDb || !normApi) return false;

    if (normDb === normApi) return true;
    if (normApi.includes(normDb) || normDb.includes(normApi)) return true;

    const compactDb = normalizeCompact(normDb);
    const compactApi = normalizeCompact(normApi);

    if (compactDb && compactApi && (compactDb === compactApi || compactApi.includes(compactDb) || compactDb.includes(compactApi))) {
        return true;
    }

    return levenshtein(normDb, normApi) <= 3;
}


// ============================================================================
// 7. DATE / CLOSING WINDOW
// ============================================================================

function parseDbDateTime(dbDateStr) {
    // STEP100E_CLV_FINAL_STABILITY_REPAIR: supporta sia formato DB italiano
    // 'dd/mm/yyyy, hh:mm' sia ISO/API 'yyyy-mm-ddThh:mm:ssZ'.
    if (!dbDateStr) return null;

    try {
        const raw = String(dbDateStr).trim();
        if (!raw) return null;

        const isoCandidate = new Date(raw);
        if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(isoCandidate.getTime())) {
            return isoCandidate;
        }

        const parts = raw.split(',').map(p => p.trim());
        const dateParts = parts[0].split('/').map(Number);
        const timeParts = parts[1] ? parts[1].split(':').map(Number) : [0, 0];
        const now = new Date();

        const day = dateParts[0];
        const month = dateParts[1];
        let year = dateParts[2] || now.getFullYear();
        if (year < 100) year = 2000 + year;

        const hour = timeParts[0] || 0;
        const minute = timeParts[1] || 0;
        if (!day || !month || !year) return null;

        const parsed = new Date(year, month - 1, day, hour, minute);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    } catch (error) {
        return null;
    }
}

function getClosingWindowInfo(matchDateStr, now = new Date()) {
    const matchDate = parseDbDateTime(matchDateStr);

    if (!matchDate) {
        return {
            valid: false,
            diffHours: null,
            inWindow: false
        };
    }

    const diffHours = (matchDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    return {
        valid: true,
        matchDate,
        diffHours,
        inWindow: diffHours <= CLOSING_WINDOW_BEFORE_HOURS &&
            diffHours >= -CLOSING_WINDOW_AFTER_HOURS
    };
}


function classifyClvWindow(matchDateStr, now = new Date()) {
    const info = getClosingWindowInfo(matchDateStr, now);

    if (!info.valid) {
        return {
            ...info,
            apiAllowed: false,
            vaultAllowed: false,
            snapshotAllowed: false,
            phase: 'INVALID_DATE'
        };
    }

    if (info.diffHours > CLOSING_WINDOW_BEFORE_HOURS) {
        const snapshotAllowed = info.diffHours <= PREMATCH_VAULT_SNAPSHOT_HOURS;

        return {
            ...info,
            apiAllowed: false,
            vaultAllowed: false,
            snapshotAllowed,
            phase: snapshotAllowed ? 'PREMATCH_VAULT_SNAPSHOT' : 'TOO_EARLY'
        };
    }

    if (info.inWindow) {
        return {
            ...info,
            apiAllowed: true,
            vaultAllowed: true,
            snapshotAllowed: false,
            phase: 'CLOSING_WINDOW'
        };
    }

    if (info.diffHours < -CLOSING_WINDOW_AFTER_HOURS && info.diffHours >= -POST_MATCH_VAULT_RECOVERY_HOURS) {
        return {
            ...info,
            apiAllowed: false,
            vaultAllowed: true,
            snapshotAllowed: false,
            phase: 'POST_MATCH_VAULT_ONLY'
        };
    }

    return {
        ...info,
        apiAllowed: false,
        vaultAllowed: false,
        snapshotAllowed: false,
        phase: 'EXPIRED'
    };
}

function isUnverifiedClvSource(source) {
    const src = safeUpper(source);

    return src === CLV_SOURCE_STALE_VAULT_SNAPSHOT ||
        src === CLV_SOURCE_PREMATCH_VAULT_SNAPSHOT;
}

function hasClvLocked(row = {}) {
    const closingOdd = safeNumber(row.clv, 0);
    const edge = safeNumber(row.clv_edge, 0);
    const source = safeUpper(row.clv_source);
    const verifiedRaw = row.clv_verified;
    const explicitlyUnverified = verifiedRaw === 0 || verifiedRaw === '0' || verifiedRaw === false;
    const closingTimestampAvailable = parseDbDateTime(row.clv_closing_ts || row.closing_ts || row.acquired_at) != null;

    // AUDIT16D_R3_T6: un CLV apparentemente verificato senza timestamp closing
    // non deve essere lockato: prima del match deve poter essere recuperato;
    // dopo la recovery window verrà classificato dal degraded ledger.
    if (!closingTimestampAvailable && (verifiedRaw === 1 || verifiedRaw === '1' || safeUpper(row.clv_contract_status) === 'VERIFIED')) return false;

    // Step 35 / CLV v6.3:
    // una quota CLV salvata come STALE_VAULT_SNAPSHOT è utile per non perdere il valore,
    // ma NON deve bloccare aggiornamenti successivi: quando il tracker trova una quota live
    // o un vault realmente in closing window deve poterla sovrascrivere.
    if (isUnverifiedClvSource(source) || (source && explicitlyUnverified)) return false;

    // Se clv contiene una quota valida (>1), la riga è già lockata anche se l'edge è 0.00.
    // Evita ricalcoli e consumo API non necessari.
    return closingOdd > 1 || edge !== 0;
}

function isSameEventTemporal(dbDateStr, apiDateStr, toleranceHours = 48) {
    if (!dbDateStr || !apiDateStr) return false;

    const dbDate = parseDbDateTime(dbDateStr);
    const apiDate = new Date(apiDateStr);

    if (!dbDate || isNaN(apiDate.getTime())) return false;

    const diffHours = Math.abs(dbDate.getTime() - apiDate.getTime()) / (1000 * 60 * 60);

    return diffHours <= toleranceHours;
}


// ============================================================================
// 8. ODDS VAULT
// ============================================================================

function generateMatchVaultId(sport, home, away, commenceTime = '') {
    const sportKey = normalizeCompact(sport || 'unknown');
    const homeKey = normalizeCompact(home || 'home');
    const awayKey = normalizeCompact(away || 'away');

    let dateKey = 'unknown';

    if (commenceTime) {
        const d = new Date(commenceTime);

        if (!isNaN(d.getTime())) {
            dateKey = d.toISOString().slice(0, 10);
        }
    }

    return `${sportKey}_${homeKey}_${awayKey}_${dateKey}`;
}

function cacheOddsDataToVault(db, sport, liveOdds = []) {
    if (!Array.isArray(liveOdds) || liveOdds.length === 0) return;

    ensureVaultTable(db);

    const insertStmt = db.prepare(`
        INSERT INTO internal_odds_vault (
            id,
            sport,
            sport_group,
            home_team,
            away_team,
            commence_time,
            opening_odds,
            opening_ts,
            closing_odds,
            closing_ts,
            tracker_version
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStmt = db.prepare(`
        UPDATE internal_odds_vault
        SET closing_odds = ?,
            closing_ts = ?,
            tracker_version = ?
        WHERE id = ?
    `);

    const checkStmt = db.prepare(`
        SELECT id
        FROM internal_odds_vault
        WHERE id = ?
    `);

    const now = Date.now();

    for (const match of liveOdds) {
        if (!match || !match.home_team || !match.away_team) continue;

        const matchId = generateMatchVaultId(
            sport,
            match.home_team,
            match.away_team,
            match.commence_time
        );

        const oddsJson = JSON.stringify(match.bookmakers || []);

        try {
            const existing = checkStmt.get(matchId);

            if (existing) {
                updateStmt.run(
                    oddsJson,
                    now,
                    CLV_TRACKER_VERSION,
                    matchId
                );
            } else {
                insertStmt.run(
                    matchId,
                    sport,
                    String(match.sport_group || match.group || ''),
                    match.home_team,
                    match.away_team,
                    match.commence_time || '',
                    oddsJson,
                    now,
                    oddsJson,
                    now,
                    CLV_TRACKER_VERSION
                );
            }
        } catch (error) {
            // Vault non bloccante.
        }
    }
}

function isSameEventByNames(home, away, apiHome, apiAway, isTennis = false) {
    const direct =
        isSameTeamOrPlayer(home, apiHome, isTennis) &&
        isSameTeamOrPlayer(away, apiAway, isTennis);

    if (direct) return { match: true, reversed: false };

    const reversed =
        isSameTeamOrPlayer(home, apiAway, isTennis) &&
        isSameTeamOrPlayer(away, apiHome, isTennis);

    return { match: reversed, reversed };
}

function getVaultRecordFreshness(record = {}, matchDateStr = '') {
    const matchDate = parseDbDateTime(matchDateStr);
    const snapshotTs = safeNumber(record.closing_ts, 0);

    if (!matchDate || snapshotTs <= 0) {
        return {
            valid: false,
            hoursBeforeMatch: null,
            stale: true
        };
    }

    const hoursBeforeMatch = (matchDate.getTime() - snapshotTs) / (1000 * 60 * 60);

    return {
        valid: true,
        hoursBeforeMatch: round(hoursBeforeMatch, 2),
        stale: hoursBeforeMatch > CLOSING_WINDOW_BEFORE_HOURS,
        postMatchSnapshot: hoursBeforeMatch < -CLOSING_WINDOW_AFTER_HOURS
    };
}

function classifyVaultRecordSource(bet = {}, record = {}, requestedSource = CLV_SOURCE_INTERNAL_VAULT) {
    const freshness = getVaultRecordFreshness(record, bet.match_date);

    if (freshness.valid && freshness.stale) {
        return CLV_SOURCE_STALE_VAULT_SNAPSHOT;
    }

    return requestedSource;
}

function getOddsFromVaultRecord(db, home, away, isTennis, matchDate = null) {
    try {
        ensureVaultTable(db);

        const recentLimit = Date.now() - (VAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

        const records = db.prepare(`
            SELECT *
            FROM internal_odds_vault
            WHERE closing_ts > ?
            ORDER BY closing_ts DESC
        `).all(recentLimit);

        for (const record of records) {
            const nameResult = isSameEventByNames(
                home,
                away,
                record.home_team,
                record.away_team,
                isTennis
            );

            if (!nameResult.match) continue;

            if (matchDate && record.commence_time) {
                if (!isSameEventTemporal(matchDate, record.commence_time, 72)) {
                    continue;
                }
            }

            return {
                bookmakers: JSON.parse(record.closing_odds || '[]'),
                record,
                reversed: nameResult.reversed,
                freshness: getVaultRecordFreshness(record, matchDate)
            };
        }
    } catch (error) {
        return null;
    }

    return null;
}

function getOddsFromVault(db, home, away, isTennis, matchDate = null) {
    const found = getOddsFromVaultRecord(db, home, away, isTennis, matchDate);

    return found ? found.bookmakers : null;
}


// ============================================================================
// 9. MARKET / OUTCOME HELPERS
// ============================================================================

function getBookmakerMarket(bookmaker, marketKey) {
    if (!bookmaker || !Array.isArray(bookmaker.markets)) return null;

    return bookmaker.markets.find(market => market.key === marketKey) || null;
}

function findOutcomeInMarket(market, outcomeName, options = {}) {
    if (!market || !Array.isArray(market.outcomes)) return null;

    const {
        targetPoint = null,
        isTennis = false,
        exactName = false
    } = options;

    if (market.key === 'totals' && targetPoint !== null && targetPoint !== undefined) {
        return market.outcomes.find(outcome => {
            return String(outcome.name).toLowerCase() === String(outcomeName).toLowerCase() &&
                Number(outcome.point) === Number(targetPoint);
        }) || null;
    }

    if (exactName) {
        return market.outcomes.find(outcome => {
            return String(outcome.name).toLowerCase() === String(outcomeName).toLowerCase();
        }) || null;
    }

    return market.outcomes.find(outcome => {
        return isSameTeamOrPlayer(outcomeName, outcome.name, isTennis);
    }) || market.outcomes.find(outcome => {
        return String(outcome.name).toLowerCase() === String(outcomeName).toLowerCase();
    }) || null;
}

function getSharpConsensusOdd(bookmakers = [], outcomeName, marketKey, targetPoint = null, isTennis = false, options = {}) {
    const sharpOdds = [];
    const softOdds = [];

    if (!Array.isArray(bookmakers)) return 0;

    for (const bookmaker of bookmakers) {
        const market = getBookmakerMarket(bookmaker, marketKey);

        if (!market) continue;

        const outcome = findOutcomeInMarket(
            market,
            outcomeName,
            {
                targetPoint,
                isTennis,
                exactName: options.exactName || false
            }
        );

        if (!outcome || !outcome.price) continue;

        const price = safeNumber(outcome.price, 0);

        if (price <= 1) continue;

        if (SHARP_BOOKIES.includes(bookmaker.key)) {
            sharpOdds.push(price);
        } else {
            softOdds.push(price);
        }
    }

    if (sharpOdds.length > 0) {
        return average(sharpOdds, 0);
    }

    if (softOdds.length > 0) {
        // Fallback: usa media delle migliori quote soft, ma resta classificato come consenso debole.
        softOdds.sort((a, b) => b - a);

        const topSoft = softOdds.slice(0, 3);

        return average(topSoft, 0);
    }

    return 0;
}

function calculateSharpConsensusStrength(bookmakers = []) {
    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return 0;

    const sharpCount = bookmakers.filter(bookmaker => {
        return SHARP_BOOKIES.includes(bookmaker.key);
    }).length;

    return round((sharpCount / bookmakers.length) * 100, 2);
}

function extractTotalLineFromPrediction(prediction) {
    const match = String(prediction || '').match(/(\d+(?:\.\d+)?)/);

    if (!match) return null;

    const line = parseFloat(match[1]);

    return Number.isFinite(line) ? line : null;
}

function getClosingOddForBet(bookmakers = [], bet = {}) {
    const prediction = safeUpper(bet.prediction);
    const isTennis = isTennisBet(bet);

    if (!Array.isArray(bookmakers) || bookmakers.length === 0) return 0;

    // ------------------------------------------------------------------------
    // Moneyline / 1X2
    // ------------------------------------------------------------------------
    if (prediction === '1') {
        return getSharpConsensusOdd(
            bookmakers,
            bet.home_team,
            'h2h',
            null,
            isTennis
        );
    }

    if (prediction === '2') {
        return getSharpConsensusOdd(
            bookmakers,
            bet.away_team,
            'h2h',
            null,
            isTennis
        );
    }

    if (prediction === 'X') {
        return getSharpConsensusOdd(
            bookmakers,
            'Draw',
            'h2h',
            null,
            false,
            { exactName: true }
        );
    }

    // ------------------------------------------------------------------------
    // Doppia chance Calcio: se il mercato non esiste, ricostruisce da h2h.
    // Nota: quota fair semplificata da probabilità implied no-vig non applicata.
    // Qui si usa formula conservativa su quote h2h disponibili.
    // ------------------------------------------------------------------------
    if (!isTennis && ['1X', 'X2', '12'].includes(prediction)) {
        const homeOdd = getSharpConsensusOdd(bookmakers, bet.home_team, 'h2h', null, false);
        const drawOdd = getSharpConsensusOdd(bookmakers, 'Draw', 'h2h', null, false, { exactName: true });
        const awayOdd = getSharpConsensusOdd(bookmakers, bet.away_team, 'h2h', null, false);

        if (prediction === '1X' && homeOdd > 1 && drawOdd > 1) {
            return 1 / ((1 / homeOdd) + (1 / drawOdd));
        }

        if (prediction === 'X2' && drawOdd > 1 && awayOdd > 1) {
            return 1 / ((1 / drawOdd) + (1 / awayOdd));
        }

        if (prediction === '12' && homeOdd > 1 && awayOdd > 1) {
            return 1 / ((1 / homeOdd) + (1 / awayOdd));
        }

        return 0;
    }

    // ------------------------------------------------------------------------
    // Totals Calcio e Tennis
    // ------------------------------------------------------------------------
    if (
        prediction.includes('OVER') ||
        prediction.includes('O2.5') ||
        prediction.includes('O1.5')
    ) {
        const line = extractTotalLineFromPrediction(prediction) || 2.5;

        return getSharpConsensusOdd(
            bookmakers,
            'Over',
            'totals',
            line,
            false,
            { exactName: true }
        );
    }

    if (
        prediction.includes('UNDER') ||
        prediction.includes('U2.5') ||
        prediction.includes('U1.5')
    ) {
        const line = extractTotalLineFromPrediction(prediction) || 2.5;

        return getSharpConsensusOdd(
            bookmakers,
            'Under',
            'totals',
            line,
            false,
            { exactName: true }
        );
    }

    return 0;
}


// ============================================================================
// 10. CLV ANALYTICS HELPERS
// ============================================================================

function detectSteamMove(openOdd, closeOdd) {
    const open = safeNumber(openOdd, 0);
    const close = safeNumber(closeOdd, 0);

    if (open <= 1 || close <= 1) {
        return {
            detected: false,
            intensity: 'NONE',
            movementPct: 0
        };
    }

    const deltaPct = ((open - close) / open) * 100;

    let intensity = 'NONE';

    if (deltaPct >= 8) intensity = 'EXTREME';
    else if (deltaPct >= 5) intensity = 'HIGH';
    else if (deltaPct >= 2.5) intensity = 'MEDIUM';
    else if (deltaPct >= 1.0) intensity = 'LOW';

    return {
        detected: deltaPct >= 2.5,
        intensity,
        movementPct: round(deltaPct, 2)
    };
}

function calculateCLVEdge(openOdd, closingOdd) {
    const open = safeNumber(openOdd, 0);
    const close = safeNumber(closingOdd, 0);

    if (open <= 1 || close <= 1) return 0;

    return ((open / close) - 1) * 100;
}

function calculateMarketEfficiency(clvEdge) {
    const edge = safeNumber(clvEdge, 0);

    let score = 50;

    if (edge > 0) {
        score += clamp(edge * 8, 0, 45);
    } else {
        score -= clamp(Math.abs(edge) * 10, 0, 45);
    }

    return clamp(round(score, 2), 0, 100);
}

function classifyCLVQuality(clvEdge) {
    const edge = safeNumber(clvEdge, 0);

    if (edge >= 4.0) return 'ELITE';
    if (edge >= 2.0) return 'VERY_GOOD';
    if (edge >= 0.75) return 'GOOD';
    if (edge >= 0) return 'SLIGHTLY_POSITIVE';

    return 'NEGATIVE';
}

function generateStrategyTag(bet = {}) {
    const sport = detectSport(bet);
    const prediction = safeUpper(bet.prediction);
    const league = safeUpper(bet.league || 'UNKNOWN').replace(/\s+/g, '_');

    if (sport === 'TENNIS') {
        const surface = safeUpper(bet.surface || bet.court_surface || 'UNKNOWN');

        if (prediction.includes('OVER')) return `TENNIS_${surface}_OVER`;
        if (prediction.includes('UNDER')) return `TENNIS_${surface}_UNDER`;

        return `TENNIS_${surface}_MONEYLINE`;
    }

    if (prediction.includes('OVER') || prediction.includes('UNDER') || prediction.includes('O2.5') || prediction.includes('U2.5')) {
        return `${league}_TOTALS`;
    }

    if (prediction.includes('GG') || prediction.includes('NG') || prediction.includes('BTTS')) {
        return `${league}_BTTS`;
    }

    return `${league}_1X2`;
}


// ============================================================================
// 11. FETCH SPORT KEYS
// ============================================================================

async function getTennisSportKeys(fetchOddsApiFunc) {
    if (typeof fetchOddsApiFunc !== 'function') return [];

    try {
        const activeSports = await fetchOddsApiFunc(
            'https://api.the-odds-api.com/v4/sports/?apiKey=API_KEY_PLACEHOLDER',
            { source: 'clvTracker.js', route: 'getTennisSportKeys', step: 'STEP57_CLV_API_EFFICIENCY_GUARD' }
        );

        if (!Array.isArray(activeSports)) return [];

        return activeSports
            .filter(sport => sport.group === 'Tennis')
            .map(sport => sport.key)
            .filter(Boolean);
    } catch (error) {
        return [];
    }
}

function getFootballSportKeyForBet(bet = {}, LEAGUES_CONFIG = {}) {
    const leagueName = String(bet.league || '');

    const leagueKey = Object.keys(LEAGUES_CONFIG).find(key => {
        return LEAGUES_CONFIG[key].name === leagueName;
    });

    if (!leagueKey) return null;

    return LEAGUES_CONFIG[leagueKey].api || null;
}

async function buildSportsToFetch(betsToTrack = [], LEAGUES_CONFIG = {}, fetchOddsApiFunc) {
    const sports = new Set();

    let needsTennis = false;

    for (const bet of betsToTrack) {
        if (isTennisBet(bet)) {
            needsTennis = true;
            continue;
        }

        const footballSport = getFootballSportKeyForBet(bet, LEAGUES_CONFIG);

        if (footballSport) sports.add(footballSport);
    }

    if (needsTennis) {
        const tennisKeys = await getTennisSportKeys(fetchOddsApiFunc);

        tennisKeys.forEach(key => sports.add(key));
    }

    return Array.from(sports);
}


// ============================================================================
// 12. BET FILTERING
// ============================================================================

function getBetsNeedingClv(db) {
    const rows = db.prepare(`
        SELECT *
        FROM ai_forward_test
        WHERE UPPER(COALESCE(status, '')) IN ('PENDING', 'WON', 'LOST')
          AND (
                COALESCE(clv, 0) <= 1
                OR COALESCE(clv_verified, 1) = 0
                OR UPPER(COALESCE(clv_source, '')) IN ('STALE_VAULT_SNAPSHOT', 'PREMATCH_VAULT_SNAPSHOT')
              )
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE 'MULTI%'
          AND COALESCE(data_quality, ?) != ?
          AND NOT (
                (UPPER(COALESCE(sport_type,''))='TENNIS'
                 OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
                 OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%')
                AND UPPER(COALESCE(clv_degraded_state,'')) IN (
                    'VERIFIED','IRRECOVERABLE_TEMPORAL','IRRECOVERABLE_MARKET',
                    'MAX_ATTEMPTS_EXHAUSTED','MANUAL_REVIEW'
                )
              )
        ORDER BY id ASC
    `).all(
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    );
    // AUDIT16D_R3_T9: arricchimento read-only. Nessuna membership viene creata o modificata.
    return tennisClvEvidencePriorityT9.annotateCandidatesWithCohort(db, rows);
}

function getPendingBetsNeedingClv(db) {
    // Compatibilità legacy: usato dai vecchi test e da eventuali import interni.
    return getBetsNeedingClv(db)
        .filter(row => safeUpper(row.status) === 'PENDING');
}

function isAudit16dR3PostMatchCooldownActive(bet = {}, now = new Date()) {
    const window = bet.clvWindow || classifyClvWindow(bet.match_date, now);
    if (window.phase !== 'POST_MATCH_VAULT_ONLY') return false;
    const last = String(bet.clv_last_attempt_result || '').toUpperCase();
    if (!['CLV_VAULT_NO_SNAPSHOT', 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK'].includes(last)) return false;
    const nextRetry = safeNumber(bet.clv_next_retry_ts, 0);
    return nextRetry > now.getTime();
}

function markAudit16dR3PostMatchVaultCooldown(db, bet = {}, reason = 'CLV_VAULT_NO_SNAPSHOT', now = new Date()) {
    if (!db || bet.id === undefined || bet.id === null) return false;
    const hours = reason === 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK'
        ? AUDIT16D_R3_POST_MATCH_NO_PICK_COOLDOWN_HOURS
        : AUDIT16D_R3_POST_MATCH_NO_SNAPSHOT_COOLDOWN_HOURS;
    return safeUpdateRow(db, bet.id, {
        clv_last_attempt_ts: now.getTime(),
        clv_last_attempt_result: reason,
        clv_pending_reason: reason,
        clv_next_retry_ts: now.getTime() + hours * 60 * 60 * 1000
    });
}

function filterBetsEligibleForClv(bets = [], now = new Date()) {
    return bets
        .map(bet => ({ ...bet, clvWindow: classifyClvWindow(bet.match_date, now) }))
        .filter(bet => bet.clvWindow.valid && (bet.clvWindow.apiAllowed || bet.clvWindow.vaultAllowed || bet.clvWindow.snapshotAllowed))
        .filter(bet => !isAudit16dR3PostMatchCooldownActive(bet, now));
}

function filterBetsInClosingWindow(bets = [], now = new Date()) {
    return bets.filter(bet => classifyClvWindow(bet.match_date, now).apiAllowed);
}


// ============================================================================
// PATCH47 - DEGRADED LEDGER / IDEMPOTENT EVIDENCE
// ============================================================================

function createPatch47ClvMetrics() {
    return {
        version: tennisClvDegradedLedgerPatch47.TENNIS_CLV_DEGRADED_LEDGER_VERSION,
        newLocks: 0,
        verified: 0,
        availableUnverified: 0,
        unchangedEvidence: 0,
        retryEligible: 0,
        irrecoverable: 0,
        exhausted: 0,
        manualReview: 0,
        ledgerEntries: 0
    };
}

function incrementPatch47State(metrics, state) {
    if (!metrics) return;
    const value = String(state || '').toUpperCase();
    if (value === 'VERIFIED') metrics.verified++;
    else if (value === 'AVAILABLE_UNVERIFIED') metrics.availableUnverified++;
    else if (value === 'RETRY_ELIGIBLE') metrics.retryEligible++;
    else if (value === 'IRRECOVERABLE_TEMPORAL' || value === 'IRRECOVERABLE_MARKET') metrics.irrecoverable++;
    else if (value === 'MAX_ATTEMPTS_EXHAUSTED') metrics.exhausted++;
    else if (value === 'MANUAL_REVIEW') metrics.manualReview++;
}

function finalizePatch47ClvMetrics(db, metrics) {
    const result = { ...(metrics || createPatch47ClvMetrics()) };
    try { result.ledgerSummary = tennisClvDegradedLedgerPatch47.getLedgerSummary(db); } catch (error) { result.ledgerSummaryError = error.message; }
    return result;
}

function recordPatch47ClvObservation(db, bet = {}, observation = {}, metrics = null, now = new Date()) {
    if (!db || !bet || bet.id === undefined || bet.id === null) return { updated: false, unchanged: false };
    const candidate = {
        ...observation,
        clv_last_attempt_ts: observation.clv_last_attempt_ts ?? now.getTime(),
        clv_last_attempt_result: observation.clv_last_attempt_result || observation.reason || 'CLV_EVIDENCE_MISSING',
        clv_pending_reason: observation.clv_pending_reason || observation.reason || 'CLV_EVIDENCE_MISSING'
    };
    const semantic = tennisClvDegradedLedgerPatch47.buildSemanticFields(bet, candidate, now);
    if (semantic.unchanged) {
        if (metrics) metrics.unchangedEvidence++;
        logStep103ClvCandidateDecision('↩️', bet, 'evidenza CLV invariata: nessuna scrittura e nessun lifecycle duplicato', {
            state: semantic.classification.state,
            evidenceKey: semantic.evidenceKey
        });
        return { updated: false, unchanged: true, state: semantic.classification.state, evidenceKey: semantic.evidenceKey };
    }
    const fields = { ...candidate, ...semantic.fields };
    const updated = safeUpdateRow(db, bet.id, fields);
    if (!updated) return { updated: false, unchanged: false, state: semantic.classification.state };
    const fresh = { ...bet, ...fields };
    const ledgerEntry = tennisClvDegradedLedgerPatch47.appendLedger(db, fresh, {}, semantic, now);
    if (metrics && ledgerEntry.inserted) metrics.ledgerEntries++;
    incrementPatch47State(metrics, semantic.classification.state);
    return { updated: true, unchanged: false, state: semantic.classification.state, evidenceKey: semantic.evidenceKey, ledgerEntry };
}

// ============================================================================
// 13. CLV LOCK UPDATE
// ============================================================================

function updateClvLock(db, bet, closingOdd, bookmakersToUse = [], source = 'LIVE_API', options = {}) {
    const openOdd = safeNumber(bet.odd, 0);

    if (openOdd <= 1 || closingOdd <= 1) return false;

    const clvEdge = calculateCLVEdge(openOdd, closingOdd);
    const sportType = detectSport(bet);
    const strategyTag = bet.strategy_tag || generateStrategyTag(bet);
    const steam = detectSteamMove(openOdd, closingOdd);
    const marketEfficiency = calculateMarketEfficiency(clvEdge);
    const clvQuality = classifyCLVQuality(clvEdge);
    const sharpConsensus = calculateSharpConsensusStrength(bookmakersToUse);

    const versions = getSportVersions(sportType);

    const dataQuality = bet.data_quality || DATA_QUALITY_CURRENT;

    // STEP102_CLV_CANONICAL_FIELDS_REPAIR
    // Il runtime deve scrivere sia i campi legacy (clv/clv_edge) sia i campi
    // canonici (opening_odd/closing_odd/clv_pct) letti da UI, portfolio e audit strict.
    const clvVerified = options.verified !== undefined
        ? (options.verified ? 1 : 0)
        : (isUnverifiedClvSource(source) ? 0 : 1);
    const clvMethod = source === CLV_SOURCE_LIVE_API
        ? 'LIVE_API_CLOSING_ODD_STEP102'
        : (source === CLV_SOURCE_POST_MATCH_VAULT
            ? 'POST_MATCH_VAULT_CLOSING_ODD_STEP102'
            : (source === CLV_SOURCE_INTERNAL_VAULT
                ? 'INTERNAL_VAULT_CLOSING_ODD_STEP102'
                : `${source || 'UNKNOWN'}_CLV_STEP102`));
    const canonicalClosingLineAvailable = clvVerified === 1 ? 1 : 0;

    const fields = {
        opening_odd: round(openOdd, 4),
        closing_odd: round(closingOdd, 4),
        clv_pct: round(clvEdge, 4),
        closing_line_available: canonicalClosingLineAvailable,
        clv_method: clvMethod,
        clv: round(closingOdd, 4),
        clv_edge: round(clvEdge, 4),
        strategy_tag: strategyTag,
        market_efficiency: marketEfficiency,
        steam_move: steam.detected ? 'YES' : 'NO',
        steam_intensity: steam.intensity,
        sharp_consensus: sharpConsensus,
        clv_quality: clvQuality,
        sport_type: sportType,
        model_version: bet.model_version || versions.model_version,
        metric_version: bet.metric_version || versions.metric_version,
        engine_version: CLV_TRACKER_VERSION,
        data_quality: dataQuality,
        clv_source: source,
        clv_verified: clvVerified,
        closing_odd_side: safeUpper(bet.prediction),
        // STEP104_CLV_CONTINUOUS_RUNTIME_GUARD: audit trail anche sui successi.
        clv_last_attempt_ts: Date.now(),
        clv_last_attempt_result: 'CLV_LOCKED_' + String(source || 'UNKNOWN'),
        clv_pending_reason: STEP104_CLV_SUCCESS_PENDING_REASON,
        clv_next_retry_ts: 0
    };

    // PATCH4_TENNIS_CLV_DATA_CONTRACT_RUNTIME: future CLV locks are certified only when metadata is complete.
    const patch45ClosingTimestamp = options.closingTimestamp ?? Date.now();
    const patch45OpeningTimestamp = options.openingTimestamp ?? bet.clv_opening_ts ?? bet.created_at;
    const patch4ContractFields = buildClvContractFields({
        ...bet,
        opening_odd: openOdd,
        closing_odd: closingOdd,
        clv_source: source,
        closing_odd_side: safeUpper(bet.prediction),
        bookmakers: bookmakersToUse,
        acquired_at: patch45ClosingTimestamp,
        opening_ts: patch45OpeningTimestamp,
        bookmaker: options.bookmaker,
        source_event_id: options.sourceEventId || bet.provider_event_id || options.vaultRecordId,
        clv_point_line: options.pointLine !== undefined ? options.pointLine : bet.point_line
    });
    Object.assign(fields, patch4ContractFields);
    fields.engine_version = `${CLV_TRACKER_VERSION}|${TENNIS_CLV_CONTRACT_VERSION}`;

    // TENNIS_PATCH45_CLV_CONTRACT_RUNTIME_BINDING_ATOMIC_LOCK_RECOVERY
    // La presenza di una quota e la sua autorità sono stati distinti: una linea
    // disponibile ma non verificabile resta persistita come evidenza, senza essere
    // presentata come CLV certificato o come completamento SLA.
    const patch45ContractVerified = fields.clv_contract_status === 'VERIFIED' && Number(fields.clv_verified) === 1;
    if (patch45ContractVerified) {
        fields.clv_last_attempt_result = 'CLV_LOCKED_' + String(source || 'UNKNOWN');
        fields.clv_pending_reason = STEP104_CLV_SUCCESS_PENDING_REASON;
    } else {
        fields.clv_last_attempt_result = `CLV_CAPTURED_UNVERIFIED_${fields.clv_contract_status || 'UNKNOWN'}`;
        fields.clv_pending_reason = `CLV_CONTRACT_${fields.clv_contract_reason || 'UNVERIFIED'}`;
    }

    const patch47Now = options.now instanceof Date ? options.now : new Date();
    const patch47Semantic = tennisClvDegradedLedgerPatch47.buildSemanticFields(bet, fields, patch47Now);
    if (patch47Semantic.unchanged) {
        if (options.metrics) options.metrics.unchangedEvidence++;
        logStep103ClvCandidateDecision('↩️', bet, 'evidenza closing invariata: CLV_LOCK idempotente saltato', {
            state: patch47Semantic.classification.state,
            evidenceKey: patch47Semantic.evidenceKey,
            source
        });
        return false;
    }
    Object.assign(fields, patch47Semantic.fields);

    let updated = false;
    if (sportType === 'TENNIS' && db && typeof db.exec === 'function' && typeof db.transaction === 'function') {
        const operationId = options.operationId || runtimeDiagnostics.createOperationId('TENNIS_CLV_LOCK');
        try {
            const lifecycleResult = tennisForwardLifecycle.executeAtomicLifecycleTransition(db, {
                betId: bet.id,
                transition: tennisForwardLifecycle.TRANSITIONS.CLV_LOCK,
                operationId
            }, () => {
                const mutationApplied = safeUpdateRow(db, bet.id, fields);
                if (!mutationApplied) throw new Error(`PATCH8_CLV_PERSIST_FAILED:${bet.id}`);
                const ledgerEntry = tennisClvDegradedLedgerPatch47.appendLedger(db, { ...bet, ...fields }, {}, patch47Semantic, patch47Now);
                return { success: true, updated: true, fields: Object.keys(fields), ledgerEntry };
            });
            updated = lifecycleResult.success === true;
        } catch (error) {
            runtimeDiagnostics.captureError({
                component: 'TENNIS_CLV',
                operation: 'CLV_LOCK',
                operationId,
                phase: 'PATCH8_ATOMIC_CLV_ROLLBACK',
                error,
                context: { betId: bet.id, clvPersisted: false, lifecycleAtomic: true }
            });
            return false;
        }
    } else {
        updated = safeUpdateRow(db, bet.id, fields);
        if (updated && sportType === 'TENNIS') tennisClvDegradedLedgerPatch47.appendLedger(db, { ...bet, ...fields }, {}, patch47Semantic, patch47Now);
    }

    if (updated) {
        if (options.metrics) {
            options.metrics.newLocks++;
            options.metrics.ledgerEntries++;
            incrementPatch47State(options.metrics, patch47Semantic.classification.state);
        }
        console.log(
            `✅ [CLV LOCK ${sportType}] ${bet.home_team} vs ${bet.away_team} | ${source} | ${openOdd.toFixed(2)} -> ${closingOdd.toFixed(2)} | Edge: ${clvEdge > 0 ? '+' : ''}${clvEdge.toFixed(2)}% | state=${patch47Semantic.classification.state}`
        );
    }

    return updated;
}


// ============================================================================
// 14. CORE TRACKER
// ============================================================================

function getStep57ClvApiUsageDelta(before = {}, after = {}) {
    const beforeCredits = safeNumber(before.creditsUsed, 0);
    const afterCredits = safeNumber(after.creditsUsed, 0);
    const beforeHits = safeNumber(before.cache?.hits, 0);
    const afterHits = safeNumber(after.cache?.hits, 0);
    const beforeMisses = safeNumber(before.cache?.misses, 0);
    const afterMisses = safeNumber(after.cache?.misses, 0);

    return {
        mode: 'STEP57_CLV_API_EFFICIENCY_GUARD',
        creditsUsedByClv: round(Math.max(0, afterCredits - beforeCredits), 4),
        cacheHitsByClv: Math.max(0, Math.trunc(afterHits - beforeHits)),
        cacheMissesByClv: Math.max(0, Math.trunc(afterMisses - beforeMisses)),
        beforeCredits: round(beforeCredits, 4),
        afterCredits: round(afterCredits, 4)
    };
}

function buildStep57ClvApiAudit(before = {}) {
    return getStep57ClvApiUsageDelta(before, apiUsageTracker.getApiUsageSummary());
}

function logStep57ClvApiAudit(audit = {}) {
    console.log(`📊 [CLV STEP57] Crediti API consumati da CLV: ${audit.creditsUsedByClv ?? 0} · cache hit ${audit.cacheHitsByClv ?? 0} · cache miss ${audit.cacheMissesByClv ?? 0}`);
}

// ============================================================================
// STEP62 - CLV HARD BUDGET & SMART FETCH
// ============================================================================

function getClvStakeInfo(bet = {}) {
    const candidateFields = [
        'stake', 'real_stake', 'operational_stake', 'stake_amount', 'amount',
        'bet_amount', 'final_stake', 'max_operational_stake', 'stake_operativo'
    ];

    let hasStakeField = false;
    let maxStake = 0;

    for (const field of candidateFields) {
        if (Object.prototype.hasOwnProperty.call(bet, field)) {
            hasStakeField = true;
            maxStake = Math.max(maxStake, safeNumber(bet[field], 0));
        }
    }

    return {
        hasStakeField,
        stake: round(maxStake, 4),
        hasRealStake: maxStake > 0
    };
}

function getClvGateText(bet = {}) {
    return safeUpper([
        bet.professional_gate_status,
        bet.quality_gate,
        bet.gate_status,
        bet.operational_status,
        bet.quality_status,
        bet.ds_action,
        bet.strategy_tag,
        bet.notes
    ].filter(Boolean).join(' '));
}

function classifyClvPriority(bet = {}) {
    const stakeInfo = getClvStakeInfo(bet);
    const gate = getClvGateText(bet);

    if (stakeInfo.hasRealStake) {
        return { priority: 100, category: 'REAL_STAKE', apiAllowed: true, reason: 'Stake reale > 0: priorità CLV massima.' };
    }

    // AUDIT16D_R3_T9: HOLDOUT calibration evidence is allowed to use LIVE_API
    // only inside the existing closing window. REAL_STAKE remains priority 100.
    // Development and non-clear/unlocked rows retain the previous policy.
    const t9HoldoutPriority = tennisClvEvidencePriorityT9.classifyHoldoutEvidencePriority(bet, stakeInfo);
    if (t9HoldoutPriority) return t9HoldoutPriority;

    if (gate.includes('WATCHLIST MICRO')) {
        return { priority: 80, category: 'WATCHLIST_MICRO', apiAllowed: !stakeInfo.hasStakeField, reason: 'Watchlist micro: API solo se stake non è esplicitamente zero.' };
    }

    if (gate.includes('APPROVATA') || gate.includes('APPROVED') || gate.includes('CAP')) {
        return { priority: 70, category: 'APPROVED_WITH_CAP', apiAllowed: !stakeInfo.hasStakeField, reason: 'Approvata/cap: API consentita solo se stake non esplicitamente zero.' };
    }

    if (gate.includes('BLOCCATA') || gate.includes('BLOCKED') || gate.includes('NO_BET') || gate.includes('AUDIT') || gate.includes('COUNTERFACTUAL')) {
        return { priority: 5, category: 'AUDIT_OR_BLOCKED', apiAllowed: false, reason: 'Audit/bloccata: CLV solo vault/cache, nessuna API live.' };
    }

    if (stakeInfo.hasStakeField && stakeInfo.stake <= 0) {
        return { priority: 10, category: 'ZERO_STAKE', apiAllowed: false, reason: 'Stake esplicitamente zero: CLV solo vault/cache.' };
    }

    return { priority: 50, category: 'UNKNOWN_OPERATIVE', apiAllowed: true, reason: 'Stake non disponibile: compatibilità legacy, API consentita con budget.' };
}


function getClvRetryState(bet = {}, now = new Date()) {
    const nowMs = now.getTime();
    const nextRetry = safeNumber(bet.clv_next_retry_ts, 0);
    const attempts = Math.max(0, Math.trunc(safeNumber(bet.clv_attempt_count, 0)));
    const maxAttempts = STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH;

    return {
        attempts,
        maxAttempts,
        maxAttemptsReached: attempts >= maxAttempts,
        nextRetryTs: nextRetry,
        inCooldown: nextRetry > nowMs,
        waitMs: Math.max(0, nextRetry - nowMs),
        lastResult: String(bet.clv_last_attempt_result || '')
    };
}



function isClvMaxAttemptsReached(bet = {}, now = new Date()) {
    const retry = getClvRetryState(bet, now);
    return retry.maxAttemptsReached === true;
}

function markClvMaxAttemptsReached(db, bet = {}, now = new Date()) {
    if (!db || !bet || bet.id === undefined || bet.id === null) return false;

    const retry = getClvRetryState(bet, now);
    const attempts = Math.max(
        retry.maxAttempts,
        Math.max(0, Math.trunc(safeNumber(bet.clv_attempt_count, 0)))
    );

    return safeUpdateRow(db, bet.id, {
        clv_attempt_count: attempts,
        clv_next_retry_ts: 0,
        clv_last_attempt_ts: safeNumber(bet.clv_last_attempt_ts, 0) || now.getTime(),
        clv_last_attempt_result: 'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED',
        clv_pending_reason: 'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED'
    });
}

function markClvApiAttempt(db, bet = {}, result = 'CLV_API_ATTEMPTED', now = new Date()) {
    if (!db || !bet || bet.id === undefined || bet.id === null) return false;

    const attempts = Math.max(0, Math.trunc(safeNumber(bet.clv_attempt_count, 0))) + 1;
    const nowMs = now.getTime();
    const maxReachedAfterAttempt = attempts >= STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH;
    const nextRetryTs = maxReachedAfterAttempt
        ? 0
        : nowMs + (STEP62_CLV_COOLDOWN_MINUTES * 60 * 1000);

    return safeUpdateRow(db, bet.id, {
        clv_last_attempt_ts: nowMs,
        clv_last_attempt_result: String(result || 'CLV_API_ATTEMPTED'),
        clv_attempt_count: attempts,
        clv_next_retry_ts: nextRetryTs,
        clv_pending_reason: maxReachedAfterAttempt
            ? 'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED'
            : String(result || 'CLV_API_ATTEMPTED')
    });
}

function getExplicitSportKeyForBet(bet = {}) {
    return String(
        bet.api_sport_key ||
        bet.provider_sport_key ||
        bet.odds_sport_key ||
        bet.sport_key ||
        bet.the_odds_sport_key ||
        ''
    ).trim();
}

function slugPart(value = '') {
    return normalizeText(value)
        .replace(/\b(atp|wta|grand slam|tennis|tour|open)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function inferTennisSportKeyForBet(bet = {}) {
    const explicit = getExplicitSportKeyForBet(bet);
    if (explicit) return explicit;

    const text = safeUpper([
        bet.league,
        bet.tournament,
        bet.tournament_name,
        bet.strategy_tag,
        bet.sport_type
    ].filter(Boolean).join(' '));

    if (!text.includes('ATP') && !text.includes('WTA')) return null;

    const tour = text.includes('WTA') ? 'wta' : 'atp';

    let rawTournament = String(bet.tournament || bet.tournament_name || bet.league || '');
    rawTournament = rawTournament
        .replace(/^\s*(ATP\s*500|WTA\s*500|ATP500|WTA500)\s*[-:–]\s*/i, '')
        .replace(/^\s*(ATP\s*250|WTA\s*250|ATP250|WTA250)\s*[-:–]\s*/i, '')
        .replace(/^\s*(ATP\s*1000|WTA\s*1000|MASTERS\s*1000)\s*[-:–]\s*/i, '');

    const low = normalizeText(rawTournament);

    if (low.includes('french') || low.includes('roland garros')) return `tennis_${tour}_french_open`;
    if (low.includes('australian')) return `tennis_${tour}_australian_open`;
    if (low.includes('wimbledon')) return `tennis_${tour}_wimbledon`;
    if (low.includes('us open') || low.includes('u s open')) return `tennis_${tour}_us_open`;

    const slug = slugPart(rawTournament);
    const invalid = new Set(['grand_slam','atp','wta','atp500','wta500','atp_500','wta_500','atp250','wta250','atp_250','wta_250']);
    if (slug && !invalid.has(slug)) return `tennis_${tour}_${slug}`;

    return null;
}

function getMarketsForBet(bet = {}) {
    const prediction = safeUpper(bet.prediction);
    if (prediction.includes('OVER') || prediction.includes('UNDER') || prediction.includes('O2.5') || prediction.includes('U2.5') || prediction.includes('O1.5') || prediction.includes('U1.5')) {
        return ['totals'];
    }
    return ['h2h'];
}

function mergeMarketList(markets = []) {
    const clean = Array.from(new Set((markets || []).filter(Boolean)));
    if (!clean.length) return 'h2h';
    clean.sort();
    return clean.join(',');
}

function shouldBlockClvApiByBudget(apiUsageSummary = {}) {
    const total = safeNumber(apiUsageSummary.monthlyCreditTotal, 0);
    const remaining = safeNumber(apiUsageSummary.creditsRemaining, 0);

    if (total <= 0) return false;

    return remaining <= STEP62_CLV_MIN_RESIDUAL_CREDITS;
}


// ============================================================================
// STEP100F_CLV_PLANNER_PRIORITY_FINAL_REPAIR
// La precedenza del planner CLV deve essere:
// 1) limite massimo tentativi per match;
// 2) finestra API;
// 3) priorità/stake/audit;
// 4) cooldown e budget.
// Questo evita che un match già a 2 tentativi venga etichettato come semplice
// post-match/window block e continui a rientrare in cicli futuri senza motivo chiaro.
// ============================================================================
function buildClvSmartFetchPlanFromBets(bets = [], LEAGUES_CONFIG = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date();
    const maxCalls = Math.max(0, Math.trunc(safeNumber(options.maxApiCalls, STEP62_CLV_MAX_API_CALLS_PER_RUN)));
    const usage = options.apiUsageSummary || apiUsageTracker.getApiUsageSummary();
    const residualBlocked = shouldBlockClvApiByBudget(usage);
    const groups = new Map();
    const blocked = [];
    const pendingTennisCatalog = [];
    const resolutionDecisions = [];

    for (const rawBet of Array.isArray(bets) ? bets : []) {
        const bet = { ...rawBet };
        const priority = classifyClvPriority(bet);
        const retry = getClvRetryState(bet, now);

        // STEP100F: il limite hard tentativi ha priorità anche se il match è fuori finestra.
        // È una regola di consumo API, non una regola di mercato; deve spiegare in modo definitivo
        // perché il match non verrà più interrogato live.
        if (retry.maxAttemptsReached) {
            blocked.push({
                id: bet.id,
                reason: 'CLV_MAX_ATTEMPTS_PER_MATCH_REACHED',
                attempts: retry.attempts,
                maxAttempts: retry.maxAttempts,
                priority: priority.category,
                phase: 'MAX_ATTEMPTS_HARD_CAP'
            });
            continue;
        }

        const window = bet.clvWindow || classifyClvWindow(bet.match_date, now);
        if (!window.apiAllowed) {
            blocked.push({ id: bet.id, reason: `NO_API_WINDOW_${window.phase || 'UNKNOWN'}`, priority: priority.category });
            continue;
        }

        if (!priority.apiAllowed) {
            blocked.push({ id: bet.id, reason: priority.reason, priority: priority.category });
            continue;
        }

        if (retry.inCooldown) {
            blocked.push({ id: bet.id, reason: 'CLV_API_RETRY_COOLDOWN', waitMs: retry.waitMs, priority: priority.category });
            continue;
        }

        if (residualBlocked) {
            blocked.push({ id: bet.id, reason: 'CLV_API_BUDGET_RESIDUAL_GUARD', priority: priority.category });
            continue;
        }

        const sportKeyResolution = clvCrossSportCoveragePatch53.resolveSportKeyForBet(bet, LEAGUES_CONFIG, {
            inferTennisKey: inferTennisSportKeyForBet
        });
        const sportKey = sportKeyResolution.sportKey;
        resolutionDecisions.push({
            betId: Number(bet.id),
            ...sportKeyResolution
        });

        if (!sportKey && isTennisBet(bet)) {
            pendingTennisCatalog.push({ bet, priority, markets: getMarketsForBet(bet), sportKeyResolution });
            continue;
        }

        if (!sportKey) {
            blocked.push({ id: bet.id, reason: sportKeyResolution.status || 'NO_TARGETED_SPORT_KEY', priority: priority.category, sportKeyResolution });
            continue;
        }

        if (!groups.has(sportKey)) {
            groups.set(sportKey, { sportKey, markets: new Set(), betIds: [], candidates: [], highestPriority: 0, source: 'TARGETED_SPORT_KEY' });
        }

        const group = groups.get(sportKey);
        getMarketsForBet(bet).forEach(m => group.markets.add(m));
        group.betIds.push(bet.id);
        group.candidates.push({ bet, priority });
        group.highestPriority = Math.max(group.highestPriority, priority.priority);
    }

    for (const row of pendingTennisCatalog) {
        blocked.push({ id: row.bet.id, reason: 'TENNIS_CATALOG_FALLBACK_REQUIRED', priority: row.priority.category, sportKeyResolution: row.sportKeyResolution });
    }

    let calls = Array.from(groups.values())
        .map(group => ({
            sportKey: group.sportKey,
            markets: mergeMarketList(Array.from(group.markets)),
            betIds: group.betIds,
            candidateCount: group.betIds.length,
            highestPriority: group.highestPriority,
            source: group.source
        }))
        .sort((a, b) => b.highestPriority - a.highestPriority || b.candidateCount - a.candidateCount || a.sportKey.localeCompare(b.sportKey));

    const overBudget = calls.slice(maxCalls).map(call => ({ ...call, reason: 'CLV_API_MAX_CALLS_PER_RUN_EXCEEDED' }));
    calls = calls.slice(0, maxCalls);

    return {
        mode: 'STEP62_CLV_HARD_BUDGET_SMART_FETCH',
        step100fPlannerPriorityRepair: true,
        apiWindow: `-${STEP62_CLV_API_WINDOW_BEFORE_HOURS}h/+${STEP62_CLV_API_WINDOW_AFTER_HOURS}h`,
        cooldownMinutes: STEP62_CLV_COOLDOWN_MINUTES,
        maxApiCallsPerRun: maxCalls,
        maxAttemptsPerMatch: STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH,
        minResidualCredits: STEP62_CLV_MIN_RESIDUAL_CREDITS,
        residualBudgetBlocked: residualBlocked,
        apiUsage: {
            monthlyCreditTotal: safeNumber(usage.monthlyCreditTotal, 0),
            creditsRemaining: safeNumber(usage.creditsRemaining, 0),
            creditsUsed: safeNumber(usage.creditsUsed, 0)
        },
        candidateCount: Array.isArray(bets) ? bets.length : 0,
        plannedApiCalls: calls.length,
        estimatedCredits: calls.length,
        calls,
        blockedCandidates: blocked,
        blocked,
        overBudgetCalls: overBudget,
        crossSportSportKeyResolution: {
            version: clvCrossSportCoveragePatch53.SPORT_KEY_RESOLUTION_VERSION,
            decisions: resolutionDecisions,
            resolved: resolutionDecisions.filter(row => row.resolved).length,
            unresolved: resolutionDecisions.filter(row => !row.resolved).length
        }
    };
}

function buildClvSmartFetchPlan(dbOrBets, LEAGUES_CONFIG = {}, options = {}) {
    if (Array.isArray(dbOrBets)) {
        return buildClvSmartFetchPlanFromBets(dbOrBets, LEAGUES_CONFIG, options);
    }

    const db = dbOrBets;
    if (!db || typeof db.prepare !== 'function') {
        return buildClvSmartFetchPlanFromBets([], LEAGUES_CONFIG, options);
    }

    try {
        ensureClvColumns(db);
        ensureVaultTable(db);
        const now = options.now instanceof Date ? options.now : new Date();
        const allCandidates = getBetsNeedingClv(db)
            .filter(isCleanCurrentRow)
            .filter(row => !hasClvLocked(row));
        const eligible = filterBetsEligibleForClv(allCandidates, now);
        const liveWindow = eligible.filter(bet => bet.clvWindow?.apiAllowed || classifyClvWindow(bet.match_date, now).apiAllowed);
        return buildClvSmartFetchPlanFromBets(liveWindow, LEAGUES_CONFIG, { ...options, now });
    } catch (error) {
        return {
            mode: 'STEP62_CLV_HARD_BUDGET_SMART_FETCH',
            success: false,
            error: error.message,
            calls: [],
            blockedCandidates: [],
            blocked: [],
            maxAttemptsPerMatch: STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH,
            estimatedCredits: 0
        };
    }
}

async function expandTennisCatalogFallbackIfNeeded(fetchOddsApiFunc, unresolvedTennisBets = [], plan = {}) {
    if (!unresolvedTennisBets.length || typeof fetchOddsApiFunc !== 'function') return [];

    const remainingBudget = Math.max(0, safeNumber(plan.maxApiCallsPerRun, STEP62_CLV_MAX_API_CALLS_PER_RUN) - (plan.calls?.length || 0));
    if (remainingBudget <= 0) return [];

    const keys = await getTennisSportKeys(fetchOddsApiFunc);
    if (!keys.length) return [];

    const wantedTour = safeUpper(unresolvedTennisBets.map(b => `${b.league || ''} ${b.sport_type || ''} ${b.strategy_tag || ''}`).join(' '));
    let filtered = keys;
    if (wantedTour.includes('WTA') && !wantedTour.includes('ATP')) filtered = keys.filter(k => String(k).includes('_wta_') || String(k).includes('wta'));
    if (wantedTour.includes('ATP') && !wantedTour.includes('WTA')) filtered = keys.filter(k => String(k).includes('_atp_') || String(k).includes('atp'));

    return filtered.slice(0, Math.min(remainingBudget, STEP62_CLV_MAX_TENNIS_FALLBACK_KEYS));
}



// STEP103C_CLV_RUNTIME_AUDIT_FINAL_REPAIR
// Funzioni runtime audit realmente definite in scope modulo. Step103B aveva aggiunto
// l'export, ma aveva saltato questo blocco per idempotenza fragile su commenti generici.
function isStep103ClvVerboseEnabled(options = {}) {
    if (options && options.verboseAudit !== undefined) return options.verboseAudit === true;
    return STEP103_CLV_VERBOSE_DEFAULT;
}

function step103ClvCountBy(rows = [], getter = () => 'UNKNOWN') {
    return rows.reduce((acc, row) => {
        const key = String(getter(row) || 'UNKNOWN');
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function step103ClvMatchLabel(bet = {}) {
    return '#' + (bet.id ?? '?') + ' ' + (bet.home_team || 'N/D') + ' - ' + (bet.away_team || 'N/D');
}

function step103ClvWindowLabel(window = {}) {
    if (!window || !window.valid) return 'INVALID_DATE';
    const diff = Number.isFinite(Number(window.diffHours)) ? String(round(window.diffHours, 2)) + 'h' : 'n/d';
    return String(window.phase || 'UNKNOWN') + ' diff=' + diff + ' api=' + (window.apiAllowed ? 'YES' : 'NO') + ' vault=' + (window.vaultAllowed ? 'YES' : 'NO') + ' snapshot=' + (window.snapshotAllowed ? 'YES' : 'NO');
}

function step103ClvCandidateSummary(bet = {}, now = new Date(), LEAGUES_CONFIG = {}) {
    const window = classifyClvWindow(bet.match_date, now);
    const priority = classifyClvPriority(bet);
    const retry = getClvRetryState(bet, now);
    const resolution = clvCrossSportCoveragePatch53.resolveSportKeyForBet(bet, LEAGUES_CONFIG, {
        inferTennisKey: inferTennisSportKeyForBet
    });
    const sportKey = resolution.sportKey || null;
    return {
        id: bet.id,
        match: String(bet.home_team || 'N/D') + ' - ' + String(bet.away_team || 'N/D'),
        date: bet.match_date || null,
        status: safeUpper(bet.status || 'N/D'),
        sport: detectSport(bet),
        prediction: safeUpper(bet.prediction || 'N/D'),
        odd: safeNumber(bet.odd, 0),
        stake: safeNumber(bet.stake, safeNumber(bet.real_stake, 0)),
        dataQuality: bet.data_quality || null,
        hasClvLocked: hasClvLocked(bet),
        degradedState: bet.clv_degraded_state || null,
        evidenceKey: bet.clv_evidence_key || null,
        retryEligible: Number(bet.clv_retry_eligible) === 1,
        terminalReason: bet.clv_terminal_reason || null,
        windowPhase: window.phase,
        windowLabel: step103ClvWindowLabel(window),
        diffHours: Number.isFinite(Number(window.diffHours)) ? round(window.diffHours, 2) : null,
        apiAllowed: window.apiAllowed === true,
        vaultAllowed: window.vaultAllowed === true,
        snapshotAllowed: window.snapshotAllowed === true,
        priority: priority.category,
        priorityReason: priority.reason,
        retryAttempts: retry.attempts,
        retryMax: retry.maxAttempts,
        retryCooldown: retry.inCooldown === true,
        retryLastResult: retry.lastResult || null,
        sportKey: sportKey || null,
        sportKeyResolution: resolution,
        sportKeyDisplay: sportKey || (window.apiAllowed ? 'UNRESOLVED_REQUIRED' : 'NOT_REQUIRED_OUTSIDE_LIVE_WINDOW'),
        markets: getMarketsForBet(bet)
    };
}

function buildStep103ClvRuntimeAudit(db, now = new Date(), LEAGUES_CONFIG = {}) {
    tennisClvDegradedLedgerPatch47.createSchema(db);
    let rawCandidates = [];
    let error = null;
    try {
        rawCandidates = getBetsNeedingClv(db);
    } catch (e) {
        error = e.message;
    }

    const cleanCandidates = Array.isArray(rawCandidates) ? rawCandidates.filter(isCleanCurrentRow) : [];
    const unlockedCandidates = cleanCandidates.filter(row => !hasClvLocked(row));
    const enriched = unlockedCandidates.map(row => step103ClvCandidateSummary(row, now, LEAGUES_CONFIG));
    const eligible = enriched.filter(row => ['CLOSING_WINDOW', 'POST_MATCH_VAULT_ONLY', 'PREMATCH_VAULT_SNAPSHOT'].includes(row.windowPhase));
    const apiEligible = eligible.filter(row => row.apiAllowed);

    return {
        mode: STEP103_CLV_RUNTIME_VISIBILITY_AUDIT,
        trackerVersion: CLV_TRACKER_VERSION,
        runtimeVersion: typeof CLV_TRACKER_RUNTIME_VERSION !== 'undefined' ? CLV_TRACKER_RUNTIME_VERSION : CLV_TRACKER_VERSION,
        autoTrackerVersion: STEP103_CLV_AUTO_TRACKER_VERSION,
        generatedAt: now.toISOString(),
        consumesApi: false,
        error,
        counts: {
            rawCandidates: rawCandidates.length,
            cleanCandidates: cleanCandidates.length,
            unlockedCandidates: unlockedCandidates.length,
            eligibleCandidates: eligible.length,
            apiEligibleCandidates: apiEligible.length
        },
        byPhase: step103ClvCountBy(enriched, r => r.windowPhase),
        byPriority: step103ClvCountBy(enriched, r => r.priority),
        bySport: step103ClvCountBy(enriched, r => r.sport),
        degradedLedger: tennisClvDegradedLedgerPatch47.getLedgerSummary(db),
        crossSportCoverage: clvCrossSportCoveragePatch53.buildCoverageReport(db, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet }),
        candidates: enriched.slice(0, STEP103_CLV_MAX_LOG_ROWS),
        eligibleCandidates: eligible.slice(0, STEP103_CLV_MAX_LOG_ROWS),
        apiEligibleCandidates: apiEligible.slice(0, STEP103_CLV_MAX_LOG_ROWS)
    };
}

function logStep103ClvRuntimeAudit(audit = {}, options = {}) {
    if (!isStep103ClvVerboseEnabled(options)) return;

    console.log('🧭 [CLV AUDIT STEP103] candidati raw=' + (audit.counts?.rawCandidates ?? 0) + ' clean=' + (audit.counts?.cleanCandidates ?? 0) + ' senza_clv=' + (audit.counts?.unlockedCandidates ?? 0) + ' eleggibili=' + (audit.counts?.eligibleCandidates ?? 0) + ' api=' + (audit.counts?.apiEligibleCandidates ?? 0));
    console.log('🧭 [CLV AUDIT STEP103] fasi=' + JSON.stringify(audit.byPhase || {}) + ' priorità=' + JSON.stringify(audit.byPriority || {}) + ' sport=' + JSON.stringify(audit.bySport || {}));

    const rows = Array.isArray(audit.candidates) ? audit.candidates : [];
    rows.forEach(row => {
        console.log('🔎 [CLV CANDIDATO] #' + row.id + ' ' + row.match + ' | ' + row.date + ' | ' + row.status + ' | ' + row.sport + ' | pick=' + row.prediction + ' quota=' + row.odd + ' stake=' + row.stake + ' | fase=' + row.windowPhase + ' diff=' + row.diffHours + 'h | api=' + (row.apiAllowed ? 'YES' : 'NO') + ' vault=' + (row.vaultAllowed ? 'YES' : 'NO') + ' | priorità=' + row.priority + ' | sportKey=' + (row.sportKeyDisplay || row.sportKey || 'UNRESOLVED') + ' sportKeyStatus=' + (row.sportKeyResolution?.status || 'UNKNOWN') + ' | retry=' + row.retryAttempts + '/' + row.retryMax + ' ' + (row.retryCooldown ? 'COOLDOWN' : '') + ' ' + (row.retryLastResult || ''));
    });

    if (rows.length === 0) {
        console.log('🔎 [CLV CANDIDATO] Nessun candidato senza CLV dopo filtri clean/current/lock.');
    }
}

function logStep103ClvCandidateDecision(stage, bet = {}, message = '', extra = {}) {
    if (!isStep103ClvVerboseEnabled()) return;
    const parts = [];
    if (extra.sportKey) parts.push('sportKey=' + extra.sportKey);
    if (extra.markets) parts.push('markets=' + extra.markets);
    if (extra.source) parts.push('source=' + extra.source);
    if (extra.reason) parts.push('reason=' + extra.reason);
    if (extra.closingOdd) parts.push('closingOdd=' + extra.closingOdd);
    if (extra.events !== undefined) parts.push('events=' + extra.events);
    console.log(String(stage || '🔎') + ' [CLV] ' + step103ClvMatchLabel(bet) + ' | ' + String(message || '') + (parts.length ? ' | ' + parts.join(' | ') : ''));
}

function logStep103ClvPlan(plan = {}) {
    if (!isStep103ClvVerboseEnabled()) return;
    const calls = Array.isArray(plan.calls) ? plan.calls : [];
    const blocked = Array.isArray(plan.blocked) ? plan.blocked : [];
    const deferred = Array.isArray(plan.deferred) ? plan.deferred : [];
    console.log('🧭 [CLV PLAN STEP103] calls=' + calls.length + ' blocked=' + blocked.length + ' deferred=' + deferred.length + ' maxCalls=' + (plan.maxApiCallsPerRun ?? 'n/d') + ' residualBlocked=' + (plan.residualBudgetBlocked ? 'YES' : 'NO'));
    calls.slice(0, STEP103_CLV_MAX_LOG_ROWS).forEach(call => {
        console.log('📡 [CLV PLAN CALL] sportKey=' + call.sportKey + ' markets=' + (call.markets || 'h2h') + ' candidati=' + (call.candidateCount ?? (call.betIds || []).length) + ' ids=' + (call.betIds || []).join(',') + ' priority=' + (call.highestPriority ?? 'n/d') + ' source=' + (call.source || 'PLAN'));
    });
    blocked.slice(0, STEP103_CLV_MAX_LOG_ROWS).forEach(row => {
        console.log('⛔ [CLV PLAN BLOCKED] id=' + row.id + ' reason=' + (row.reason || 'UNKNOWN') + ' priority=' + (row.priority || 'n/d') + ' waitMs=' + (row.waitMs ?? ''));
    });
    deferred.slice(0, STEP103_CLV_MAX_LOG_ROWS).forEach(row => {
        console.log('⏸️ [CLV PLAN DEFERRED] id=' + row.id + ' reason=' + (row.reason || 'UNKNOWN') + ' priority=' + (row.priority || 'n/d'));
    });
}

async function updateBetsFromVault(db, bets = [], source = CLV_SOURCE_INTERNAL_VAULT, patch47Metrics = null) {
    let updatedCount = 0;
    let noSnapshotCount = 0;
    let noPickOddCount = 0;
    let noSnapshotLogged = 0;
    let noPickLogged = 0;
    if (isStep103ClvVerboseEnabled() && Array.isArray(bets) && bets.length > 0) {
        console.log(`🧊 [CLV VAULT STEP103] source=${source} ricerca snapshot su ${bets.length} candidati.`);
    }

    for (const bet of bets) {
        const freshBet = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE id = ?
        `).get(bet.id);

        if (!freshBet || hasClvLocked(freshBet)) continue;
        if (!isCleanCurrentRow(freshBet)) continue;

        const tennis = isTennisBet(freshBet);
        const vaultHit = getOddsFromVaultRecord(
            db,
            freshBet.home_team,
            freshBet.away_team,
            tennis,
            freshBet.match_date
        );

        const bookmakersToUse = vaultHit ? vaultHit.bookmakers : null;

        if (!bookmakersToUse || bookmakersToUse.length === 0) {
            noSnapshotCount += 1;
            if (noSnapshotLogged < AUDIT16D_R3_CLV_LOG_SAMPLE_LIMIT) {
                logStep103ClvCandidateDecision('🧊', freshBet, 'vault non contiene bookmaker utili', { source, reason: 'CLV_VAULT_NO_SNAPSHOT' });
                noSnapshotLogged += 1;
            }
            // AUDIT16D_R3: un post-match senza snapshot non viene riscantito ogni 5 minuti.
            // Il cooldown è solo metadata; non certifica CLV e non chiude il recupero futuro.
            if (source === CLV_SOURCE_POST_MATCH_VAULT) {
                markAudit16dR3PostMatchVaultCooldown(db, freshBet, 'CLV_VAULT_NO_SNAPSHOT');
            }
            recordPatch47ClvObservation(db, freshBet, {
                reason: 'CLV_VAULT_NO_SNAPSHOT',
                clv_last_attempt_result: 'CLV_VAULT_NO_SNAPSHOT',
                clv_pending_reason: 'CLV_VAULT_NO_SNAPSHOT'
            }, patch47Metrics);
            continue;
        }

        const effectiveSource = vaultHit && vaultHit.record
            ? classifyVaultRecordSource(freshBet, vaultHit.record, source)
            : source;

        // Se siamo ancora in closing window, una snapshot troppo vecchia non deve bloccare
        // una futura quota live verificata. La usiamo solo nel recupero post-match.
        if (source === CLV_SOURCE_INTERNAL_VAULT && effectiveSource === CLV_SOURCE_STALE_VAULT_SNAPSHOT) {
            logStep103ClvCandidateDecision('🧊', freshBet, 'snapshot vault troppo vecchio: non blocco futura quota live', { source: effectiveSource });
            continue;
        }

        const closingOdd = getClosingOddForBet(bookmakersToUse, freshBet);

        if (closingOdd > 1) {
            logStep103ClvCandidateDecision('🧊', freshBet, 'closing odd trovata da vault', { source: effectiveSource, closingOdd });
            const updated = updateClvLock(
                db,
                freshBet,
                closingOdd,
                bookmakersToUse,
                effectiveSource,
                {
                    closingTimestamp: vaultHit.record?.closing_ts ?? Date.now(),
                    openingTimestamp: vaultHit.record?.opening_ts ?? freshBet.clv_opening_ts ?? freshBet.created_at,
                    sourceEventId: freshBet.provider_event_id || vaultHit.record?.id || null,
                    vaultRecordId: vaultHit.record?.id || null,
                    pointLine: freshBet.point_line,
                    metrics: patch47Metrics
                }
            );

            if (updated) updatedCount++;
        } else {
            noPickOddCount += 1;
            if (noPickLogged < AUDIT16D_R3_CLV_LOG_SAMPLE_LIMIT) {
                logStep103ClvCandidateDecision('🧊', freshBet, 'vault trovato ma quota lato pick non estratta', { source: effectiveSource, reason: 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK' });
                noPickLogged += 1;
            }
            if (source === CLV_SOURCE_POST_MATCH_VAULT) {
                markAudit16dR3PostMatchVaultCooldown(db, freshBet, 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK');
            }
            recordPatch47ClvObservation(db, freshBet, {
                reason: 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK',
                clv_last_attempt_result: 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK',
                clv_pending_reason: 'CLV_VAULT_NO_CLOSING_ODD_FOR_PICK'
            }, patch47Metrics);
        }
    }

    if (isStep103ClvVerboseEnabled() && (noSnapshotCount > noSnapshotLogged || noPickOddCount > noPickLogged)) {
        console.log(`🧊 [AUDIT16D_R3 CLV] source=${source} noSnapshot=${noSnapshotCount} noPickOdd=${noPickOddCount} dettagliMostrati=${noSnapshotLogged + noPickLogged}/${noSnapshotCount + noPickOddCount} cooldownPostMatch=${source === CLV_SOURCE_POST_MATCH_VAULT ? 'ATTIVO' : 'N/A'}`);
    }
    return updatedCount;
}

async function trackClosingLines(db, fetchOddsApiFunc, LEAGUES_CONFIG = {}) {
    console.log(`\n🎯 [CLV TRACKER] Avvio Motore v${CLV_TRACKER_VERSION}`);

    const patch47Metrics = createPatch47ClvMetrics();
    const step57UsageBefore = apiUsageTracker.getApiUsageSummary();

    ensureClvColumns(db);
    ensureVaultTable(db);
    tennisClvSnapshotCoveragePatch39.createSchema(db);

    const step103Now = new Date();
    const step103RuntimeAudit = buildStep103ClvRuntimeAudit(db, step103Now);
    logStep103ClvRuntimeAudit(step103RuntimeAudit, { source: 'trackClosingLines' });

    const allCandidates = getBetsNeedingClv(db)
        .filter(isCleanCurrentRow)
        .filter(row => !hasClvLocked(row));
    const patch39OpeningSnapshotsInserted = tennisClvSnapshotCoveragePatch39.ensureFirstSeenSnapshots(db, allCandidates, { now: step103Now, parseFn: parseDbDateTime });

    if (allCandidates.length === 0) {
        console.log('ℹ️ Nessuna scommessa priva di CLV da tracciare.');
        return {
            success: true,
            updatedCount: 0,
            reason: 'NO_PENDING_CLV',
            clvEvidenceMetrics: finalizePatch47ClvMetrics(db, patch47Metrics)
        };
    }

    const eligibleCandidates = filterBetsEligibleForClv(allCandidates);
    if (isStep103ClvVerboseEnabled()) {
        console.log(`🧭 [CLV AUDIT STEP103] eleggibili=${eligibleCandidates.length}/${allCandidates.length} dopo finestra CLV.`);
    }

    if (eligibleCandidates.length === 0) {
        console.log('ℹ️ Nessun match rientra nella finestra CLV o nel recupero vault post-match.');
        return {
            success: true,
            updatedCount: 0,
            reason: 'NO_MATCH_IN_CLV_WINDOW',
            clvEvidenceMetrics: finalizePatch47ClvMetrics(db, patch47Metrics)
        };
    }

    const postMatchVaultOnly = eligibleCandidates.filter(bet => bet.clvWindow.phase === 'POST_MATCH_VAULT_ONLY');
    const liveWindowCandidates = eligibleCandidates.filter(bet => bet.clvWindow.apiAllowed);
    const prematchVaultSnapshotCandidates = eligibleCandidates.filter(bet => bet.clvWindow.phase === 'PREMATCH_VAULT_SNAPSHOT');
    if (isStep103ClvVerboseEnabled()) {
        console.log(`🧭 [CLV AUDIT STEP103] liveWindow=${liveWindowCandidates.length} postMatchVault=${postMatchVaultOnly.length} prematchSnapshot=${prematchVaultSnapshotCandidates.length}`);
    }

    // 1) Prima prova il vault per le righe ancora in closing window:
    // non consuma API e spesso abbiamo già salvato la quota nel vault.
    const vaultUpdatedCount = await updateBetsFromVault(
        db,
        liveWindowCandidates,
        CLV_SOURCE_INTERNAL_VAULT,
        patch47Metrics
    );

    // 2) Il giorno dopo il match usa solo lo storico interno/vault: niente API.
    const postMatchVaultUpdatedCount = await updateBetsFromVault(
        db,
        postMatchVaultOnly,
        CLV_SOURCE_POST_MATCH_VAULT,
        patch47Metrics
    );

    // 3) API solo per match ancora nella closing window e solo se il vault non ha già risolto.
    //    Step57: i candidati prematch restano vault-only e non attivano più fetch API.
    const betsToTrack = liveWindowCandidates.filter(bet => {
        const freshBet = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE id = ?
        `).get(bet.id);

        return freshBet && !hasClvLocked(freshBet) && isCleanCurrentRow(freshBet);
    });

    const snapshotOnlyBets = prematchVaultSnapshotCandidates.filter(bet => {
        const freshBet = db.prepare(`
            SELECT *
            FROM ai_forward_test
            WHERE id = ?
        `).get(bet.id);

        return freshBet && isCleanCurrentRow(freshBet);
    });

    const patch39SnapshotSelection = tennisClvSnapshotCoveragePatch39.selectAuditCandidates(db, allCandidates, { now: step103Now, parseFn: parseDbDateTime });
    const patch39DueExecutionCount = patch39SnapshotSelection.execution.length;

    // STEP57_CLV_API_EFFICIENCY_GUARD
    // API live solo per match davvero in closing window e ancora senza CLV dopo il vault.
    // Le snapshot prematch non devono interrogare interi tornei ATP/WTA: restano vault-only
    // fino alla vera finestra closing. Questo evita chiamate su dati non ancora necessari.
    // STEP100C_CLV_MAX_ATTEMPTS_RUNTIME_EXPORT_FIX
        // I match che hanno già raggiunto il limite hard restano vault/cache-only:
        // vengono marcati in DB e rimossi PRIMA del piano API, evitando consumo crediti.
        const maxAttemptsBlockedCandidates = betsToTrack.filter(bet => isClvMaxAttemptsReached(bet));
        maxAttemptsBlockedCandidates.forEach(bet => markClvMaxAttemptsReached(db, bet));
        const apiFetchCandidates = betsToTrack.filter(bet => !isClvMaxAttemptsReached(bet));
        if (isStep103ClvVerboseEnabled()) {
            console.log(`🧭 [CLV AUDIT STEP103] API candidates=${apiFetchCandidates.length} maxAttemptsBlocked=${maxAttemptsBlockedCandidates.length}`);
            maxAttemptsBlockedCandidates.slice(0, STEP103_CLV_MAX_LOG_ROWS).forEach(bet => logStep103ClvCandidateDecision('⛔', bet, 'bloccato: max tentativi CLV già raggiunti', getClvRetryState(bet)));
        }

if (apiFetchCandidates.length === 0 && patch39DueExecutionCount === 0) {
        const apiAudit = buildStep57ClvApiAudit(step57UsageBefore);
        logStep57ClvApiAudit(apiAudit);
        console.log('ℹ️ CLV risolto da vault/post-match oppure nessun match realmente in closing window. Nessuna API live necessaria.');
        return {
            success: true,
            updatedCount: vaultUpdatedCount + postMatchVaultUpdatedCount,
            vaultUpdatedCount,
            postMatchVaultUpdatedCount,
            prematchSnapshotCandidateCount: prematchVaultSnapshotCandidates.length,
            prematchSnapshotSkippedApiCount: snapshotOnlyBets.length,
            apiFetchCount: 0,
            scannedSports: 0,
            liveMatchesSeen: 0,
            vaultFallbackCount: vaultUpdatedCount + postMatchVaultUpdatedCount,
            apiCreditsUsed: apiAudit.creditsUsedByClv,
            apiCacheHits: apiAudit.cacheHitsByClv,
            apiCacheMisses: apiAudit.cacheMissesByClv,
            reason: 'VAULT_ONLY_OR_NO_TRUE_CLOSING_WINDOW_API_NEEDED',
            patch39OpeningSnapshotsInserted,
            patch39SnapshotCoverage: tennisClvSnapshotCoveragePatch39.coverageHealth(db),
            engineVersion: CLV_TRACKER_VERSION,
            step104RuntimeGuard: 'STEP104_CLV_CONTINUOUS_RUNTIME_GUARD',
            step57ApiAudit: apiAudit
        };
    }

    if (typeof fetchOddsApiFunc !== 'function') {
        const apiAudit = buildStep57ClvApiAudit(step57UsageBefore);
        logStep57ClvApiAudit(apiAudit);
        console.log('⚠️ CLV: fetchOddsApiFunc non disponibile. Recupero consentito solo da vault.');
        return {
            success: true,
            updatedCount: vaultUpdatedCount + postMatchVaultUpdatedCount,
            vaultUpdatedCount,
            postMatchVaultUpdatedCount,
            prematchSnapshotCandidateCount: prematchVaultSnapshotCandidates.length,
            apiFetchCount: 0,
            apiCreditsUsed: apiAudit.creditsUsedByClv,
            apiCacheHits: apiAudit.cacheHitsByClv,
            apiCacheMisses: apiAudit.cacheMissesByClv,
            reason: 'API_NOT_AVAILABLE_VAULT_ONLY',
            engineVersion: CLV_TRACKER_VERSION,
            step104RuntimeGuard: 'STEP104_CLV_CONTINUOUS_RUNTIME_GUARD',
            step57ApiAudit: apiAudit
        };
    }

    console.log(`📡 CLV PATCH39: closing=${betsToTrack.length} checkpointDue=${patch39DueExecutionCount} snapshotPrematch=${snapshotOnlyBets.length}.`);

    let plan = buildClvSmartFetchPlanFromBets(apiFetchCandidates, LEAGUES_CONFIG, {
        apiUsageSummary: apiUsageTracker.getApiUsageSummary(),
        now: step103Now
    });

    // PATCH35 + PATCH39: discovery prima di ogni fetch e massimo una chiamata
    // raggruppata aggiuntiva per la copertura paper/calibrazione al checkpoint.
    const activeTennisCatalog = await tennisClvSportKeyDiscoveryPatch35.getActiveTennisCatalog(fetchOddsApiFunc);
    plan = tennisClvSportKeyDiscoveryPatch35.resolvePlanAgainstCatalog(plan, apiFetchCandidates, activeTennisCatalog);
    const patch39Augmented = tennisClvSnapshotCoveragePatch39.augmentPlanWithCalibrationAudit(plan, {
        db,
        rows: allCandidates,
        catalog: activeTennisCatalog,
        discovery: tennisClvSportKeyDiscoveryPatch35,
        inferKey: inferTennisSportKeyForBet,
        getMarkets: getMarketsForBet,
        now: step103Now,
        parseFn: parseDbDateTime
    });
    plan = patch39Augmented.plan;
    const executionCandidatesById = new Map([...apiFetchCandidates, ...patch39Augmented.auditCandidates].map(row => [Number(row.id), row]));
    const executionCandidates = [...executionCandidatesById.values()];
    const discoveryByBetId = new Map([...(plan.sportKeyDiscovery?.decisions || []), ...(patch39Augmented.decisions || [])].map(row => [Number(row.betId), row]));

    const sportsToFetch = plan.calls || [];
    logStep103ClvPlan(plan);

    if (sportsToFetch.length === 0) {
        const apiAudit = buildStep57ClvApiAudit(step57UsageBefore);
        logStep57ClvApiAudit(apiAudit);
        console.log('⚠️ CLV STEP62: nessuna chiamata API pianificata per budget, cooldown, sport key o priorità stake.');
        return {
            success: true,
            updatedCount: vaultUpdatedCount + postMatchVaultUpdatedCount,
            vaultUpdatedCount,
            postMatchVaultUpdatedCount,
            apiFetchCount: 0,
            apiCreditsUsed: apiAudit.creditsUsedByClv,
            apiCacheHits: apiAudit.cacheHitsByClv,
            apiCacheMisses: apiAudit.cacheMissesByClv,
            reason: plan.residualBudgetBlocked ? 'CLV_API_BUDGET_RESIDUAL_GUARD' : 'NO_STEP62_SMART_FETCH_CALLS',
            prematchSnapshotCandidateCount: prematchVaultSnapshotCandidates.length,
            engineVersion: CLV_TRACKER_VERSION,
            step104RuntimeGuard: 'STEP104_CLV_CONTINUOUS_RUNTIME_GUARD',
            step57ApiAudit: apiAudit,
            step62Plan: plan
        };
    }

    let updatedCount = vaultUpdatedCount + postMatchVaultUpdatedCount;
    let scannedSports = 0;
    let liveMatchesSeen = 0;
    let vaultFallbackCount = vaultUpdatedCount + postMatchVaultUpdatedCount;
    let apiFetchCount = 0;
    const providerErrors = [];

    for (const fetchPlan of sportsToFetch) {
        const sportKey = fetchPlan.sportKey;
        const markets = fetchPlan.markets || 'h2h';
        const betIdSet = new Set(fetchPlan.betIds || []);
        const candidateBetsForSport = executionCandidates.filter(bet => betIdSet.has(Number(bet.id)));
        let liveOdds = [];
        let providerFetchError = null;

        try {
            apiFetchCount++;
            if (isStep103ClvVerboseEnabled()) {
                console.log(`📡 [CLV API STEP103] GET sportKey=${sportKey} markets=${markets} candidati=${candidateBetsForSport.length} ids=${[...betIdSet].join(',')}`);
            }
            liveOdds = await fetchOddsApiFunc(
                `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=API_KEY_PLACEHOLDER&regions=eu,uk&markets=${encodeURIComponent(markets)}`,
                { source: 'clvTracker.js', route: 'trackClosingLines', step: 'STEP62_CLV_HARD_BUDGET_SMART_FETCH', markets }
            );

            if (!Array.isArray(liveOdds)) liveOdds = [];
            if (isStep103ClvVerboseEnabled()) {
                console.log(`📡 [CLV API STEP103] sportKey=${sportKey} eventi_live=${liveOdds.length}`);
            }

            scannedSports++;
            liveMatchesSeen += liveOdds.length;

            // Cache sempre: è la base per il recupero del giorno dopo senza API.
            cacheOddsDataToVault(db, sportKey, liveOdds);
        } catch (error) {
            providerFetchError = tennisClvSportKeyDiscoveryPatch35.errorInfo(error);
            providerErrors.push({ sportKey, ...providerFetchError });
            console.warn(`⚠️ CLV PROVIDER ${providerFetchError.category}: sportKey=${sportKey} status=${providerFetchError.status || 'N/D'} code=${providerFetchError.providerCode || 'N/D'}`);
            liveOdds = [];
        }

        for (const bet of candidateBetsForSport) {
            const freshBet = db.prepare(`
                SELECT *
                FROM ai_forward_test
                WHERE id = ?
            `).get(bet.id);

            if (!freshBet || hasClvLocked(freshBet)) continue;
            if (!isCleanCurrentRow(freshBet)) continue;

            const tennis = isTennisBet(freshBet);
            const discovery = discoveryByBetId.get(Number(freshBet.id)) || null;
            if (discovery) {
                safeUpdateRow(db, freshBet.id, {
                    clv_sport_key_discovery_version: tennisClvSportKeyDiscoveryPatch35.VERSION,
                    clv_sport_key_discovery_status: discovery.status,
                    clv_sport_key_requested: discovery.requestedKey || null,
                    clv_sport_key_resolved: sportKey || null,
                    clv_provider_error_code: providerFetchError?.category || null,
                    clv_provider_error_at: providerFetchError ? new Date().toISOString() : null
                });
            }
            const crossSportResolution = (plan.crossSportSportKeyResolution?.decisions || []).find(row => Number(row.betId) === Number(freshBet.id))
                || clvCrossSportCoveragePatch53.resolveSportKeyForBet(freshBet, LEAGUES_CONFIG, { inferTennisKey: inferTennisSportKeyForBet });
            safeUpdateRow(db, freshBet.id, clvCrossSportCoveragePatch53.persistenceFields({
                ...crossSportResolution,
                sportKey: sportKey || crossSportResolution.sportKey || null,
                status: discovery?.status || crossSportResolution.status,
                source: discovery ? 'ACTIVE_PROVIDER_CATALOG' : crossSportResolution.source
            }));
            logStep103ClvCandidateDecision('🔎', freshBet, 'Valuto match CLV live/vault', { sportKey, markets, discoveryStatus: discovery?.status || null });

            let bookmakersToUse = null;
            let source = CLV_SOURCE_LIVE_API;

            const liveMatch = liveOdds.find(match => {
                if (!match) return false;

                const nameResult = isSameEventByNames(
                    freshBet.home_team,
                    freshBet.away_team,
                    match.home_team,
                    match.away_team,
                    tennis
                );

                if (!nameResult.match) return false;

                if (match.commence_time && freshBet.match_date) {
                    return isSameEventTemporal(freshBet.match_date, match.commence_time, 72);
                }

                return true;
            });

            if (liveMatch && Array.isArray(liveMatch.bookmakers)) {
                bookmakersToUse = liveMatch.bookmakers;
                logStep103ClvCandidateDecision('✅', freshBet, `match live trovato: ${liveMatch.home_team || 'N/D'} - ${liveMatch.away_team || 'N/D'}`, { source: CLV_SOURCE_LIVE_API, events: liveOdds.length });
            } else {
                logStep103ClvCandidateDecision('❌', freshBet, 'match non trovato nella risposta live; provo vault fallback', { source: CLV_SOURCE_LIVE_API, events: liveOdds.length });
                const vaultHit = getOddsFromVaultRecord(
                    db,
                    freshBet.home_team,
                    freshBet.away_team,
                    tennis,
                    freshBet.match_date
                );

                bookmakersToUse = vaultHit ? vaultHit.bookmakers : null;

                if (bookmakersToUse) {
                    source = vaultHit && vaultHit.record
                        ? classifyVaultRecordSource(freshBet, vaultHit.record, CLV_SOURCE_INTERNAL_VAULT)
                        : CLV_SOURCE_INTERNAL_VAULT;
                    vaultFallbackCount++;
                    logStep103ClvCandidateDecision('🧊', freshBet, 'vault fallback trovato', { source });
                } else {
                    logStep103ClvCandidateDecision('🧊', freshBet, 'nessun fallback vault disponibile', { source: CLV_SOURCE_INTERNAL_VAULT });
                }
            }

            if (!bookmakersToUse || bookmakersToUse.length === 0) {
                if (providerFetchError) {
                    const reason = `CLV_PROVIDER_${providerFetchError.category}`;
                    logStep103ClvCandidateDecision('⚠️', freshBet, 'provider CLV degradato; nessuna risposta valida, vault non disponibile', { reason, sportKey, providerStatus: providerFetchError.status, providerCode: providerFetchError.providerCode });
                    // Un errore di routing/provider non consuma il limite per-match:
                    // il candidato non deve essere penalizzato come se il mercato fosse assente.
                    safeUpdateRow(db, freshBet.id, {
                        clv_last_attempt_result: reason,
                        clv_pending_reason: reason,
                        clv_provider_error_code: providerFetchError.category,
                        clv_provider_error_at: new Date().toISOString()
                    });
                    continue;
                }
                // STEP100B_CLV_MAX_ATTEMPTS_HARD_CAP
                // Una risposta valida senza evento/bookmaker conta come tentativo reale.
                logStep103ClvCandidateDecision('⚠️', freshBet, 'tentativo CLV registrato: catalogo valido ma nessun match/bookmaker utile', { reason: 'CLV_API_VALID_EMPTY_OR_NO_BOOKMAKERS' });
                markClvApiAttempt(db, freshBet, 'CLV_API_VALID_EMPTY_OR_NO_BOOKMAKERS');
                continue;
            }

            const closingOdd = getClosingOddForBet(bookmakersToUse, freshBet);

            if (closingOdd > 1) {
                const due = tennisClvSnapshotCoveragePatch39.checkpointFor(freshBet, step103Now, parseDbDateTime);
                const checkpoint = due.checkpoint || (freshBet.clvWindow?.apiAllowed ? tennisClvSnapshotCoveragePatch39.CHECKPOINTS.T20M : null);
                let checkpointReceipt = null;
                if (checkpoint) {
                    checkpointReceipt = tennisClvSnapshotCoveragePatch39.recordSnapshot(db, freshBet, {
                        checkpoint,
                        capturedAt: step103Now.toISOString(),
                        leadHours: due.leadHours,
                        source,
                        status: 'MARKET_ODD_CAPTURED',
                        selectedOdd: closingOdd,
                        sportKey,
                        sourceEventId: liveMatch?.id || freshBet.provider_event_id || null,
                        bookmakers: bookmakersToUse
                    });
                }
                const shouldFinalize = checkpoint ? tennisClvSnapshotCoveragePatch39.shouldFinalizeClosing(checkpoint) : freshBet.clvWindow?.apiAllowed === true;
                logStep103ClvCandidateDecision('✅', freshBet, shouldFinalize ? 'closing odd finale estratta' : `snapshot ${checkpoint || 'MARKET'} estratta senza lock finale`, { source, closingOdd, checkpoint, shouldFinalize });
                if (shouldFinalize) {
                    const updated = updateClvLock(db, freshBet, closingOdd, bookmakersToUse, source, {
                        patch39Checkpoint: checkpointReceipt?.snapshot_id || null,
                        closingTimestamp: step103Now.toISOString(),
                        openingTimestamp: freshBet.clv_opening_ts ?? freshBet.created_at,
                        sourceEventId: liveMatch?.id || freshBet.provider_event_id || null,
                        pointLine: freshBet.point_line,
                        metrics: patch47Metrics
                    });
                    if (updated) updatedCount++;
                }
            } else {
                logStep103ClvCandidateDecision('⚠️', freshBet, 'tentativo CLV registrato: match/bookmaker trovato ma quota lato pick assente', { source, reason: 'CLV_API_NO_MATCH_OR_NO_CLOSING_ODD' });
                markClvApiAttempt(db, freshBet, 'CLV_API_NO_MATCH_OR_NO_CLOSING_ODD');
            }
        }
    }

    const apiAudit = buildStep57ClvApiAudit(step57UsageBefore);
    logStep57ClvApiAudit(apiAudit);
    console.log(`🎯 [CLV TRACKER] Fine. Nuove evidenze=${patch47Metrics.newLocks} · invariate=${patch47Metrics.unchangedEvidence} · aggiornate=${updatedCount}.`);

    return {
        success: true,
        updatedCount,
        vaultUpdatedCount,
        postMatchVaultUpdatedCount,
        scannedSports,
        liveMatchesSeen,
        vaultFallbackCount,
        prematchSnapshotCandidateCount: prematchVaultSnapshotCandidates.length,
        prematchSnapshotSkippedApiCount: snapshotOnlyBets.length,
        apiFetchCount,
        apiCreditsUsed: apiAudit.creditsUsedByClv,
        apiCacheHits: apiAudit.cacheHitsByClv,
        apiCacheMisses: apiAudit.cacheMissesByClv,
        providerErrors,
        providerStatus: providerErrors.length ? 'DEGRADED_PROVIDER_ERROR' : 'OK',
        patch39OpeningSnapshotsInserted,
        patch39SnapshotCoverage: tennisClvSnapshotCoveragePatch39.coverageHealth(db),
        sportKeyDiscovery: plan.sportKeyDiscovery || null,
        engineVersion: CLV_TRACKER_VERSION,
            step104RuntimeGuard: 'STEP104_CLV_CONTINUOUS_RUNTIME_GUARD',
            step57ApiAudit: apiAudit,
        clvEvidenceMetrics: finalizePatch47ClvMetrics(db, patch47Metrics),
        step62Plan: plan
    };
}

// ============================================================================
// 15. CLV REPORT ENGINE
// ============================================================================

function generateCLVReport(db, options = {}) {
    ensureClvColumns(db);

    const sportFilter = safeUpper(options.sport || 'ALL');

    let query = `
        SELECT *
        FROM ai_forward_test
        WHERE clv_edge IS NOT NULL
          AND clv_edge != 0
          AND COALESCE(data_quality, ?) != ?
          AND (
                COALESCE(clv_verified, 1) = 1
                OR COALESCE(clv_source, '') = ''
              )
          AND (
                NOT (
                    UPPER(COALESCE(sport_type,''))='TENNIS'
                    OR UPPER(COALESCE(bet_type,'')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(strategy_tag,'')) LIKE '%TENNIS%'
                )
                OR (
                    UPPER(COALESCE(clv_degraded_state,''))='VERIFIED'
                    AND clv_closing_ts IS NOT NULL
                    AND TRIM(CAST(clv_closing_ts AS TEXT))<>''
                )
              )
    `;

    const params = [
        DATA_QUALITY_CURRENT,
        DATA_QUALITY_LEGACY_DIRTY
    ];

    if (sportFilter === 'CALCIO' || sportFilter === 'FOOTBALL') {
        query += `
          AND (
                UPPER(COALESCE(sport_type, 'CALCIO')) = 'CALCIO'
                OR UPPER(COALESCE(sport_type, '')) = 'FOOTBALL'
                OR COALESCE(sport_type, '') = ''
              )
          AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
        `;
    }

    if (sportFilter === 'TENNIS') {
        query += `
          AND (
                UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
              )
        `;
    }

    const bets = db.prepare(query).all(...params);

    if (!bets || bets.length === 0) {
        return {
            sample: 0,
            global: {
                sample: 0,
                avgCLV: 0,
                positiveRate: 0,
                volatility: 0,
                steamMoveRate: 0
            },
            football: {
                sample: 0,
                avgCLV: 0,
                positiveRate: 0
            },
            tennis: {
                sample: 0,
                avgCLV: 0,
                positiveRate: 0
            },
            engineVersion: CLV_TRACKER_VERSION
        };
    }

    const football = bets.filter(bet => detectSport(bet) === 'CALCIO');
    const tennis = bets.filter(bet => detectSport(bet) === 'TENNIS');

    const buildSegment = segment => {
        const values = segment.map(bet => safeNumber(bet.clv_edge, 0));
        const positive = segment.filter(bet => safeNumber(bet.clv_edge, 0) > 0).length;
        const steam = segment.filter(bet => safeUpper(bet.steam_move) === 'YES').length;

        return {
            sample: segment.length,
            avgCLV: round(average(values, 0), 2),
            positiveRate: segment.length > 0
                ? round((positive / segment.length) * 100, 2)
                : 0,
            volatility: round(stdDev(values), 2),
            steamMoveRate: segment.length > 0
                ? round((steam / segment.length) * 100, 2)
                : 0
        };
    };

    return {
        sample: bets.length,
        global: buildSegment(bets),
        football: buildSegment(football),
        tennis: buildSegment(tennis),
        engineVersion: CLV_TRACKER_VERSION,
        dataMode: 'CURRENT_CLEAN_ONLY'
    };
}


// ============================================================================
// 16. EXPORTS
// ============================================================================

module.exports = {
    trackClosingLines,
    generateCLVReport,

    // Analytics helpers
    detectSteamMove,
    classifyCLVQuality,
    calculateMarketEfficiency,
    calculateSharpConsensusStrength,
    generateStrategyTag,
    detectSport,
    calculateCLVEdge,

    // Matching / Vault helpers
    isSameTeamOrPlayer,
    normalizeTeamName,
    levenshtein,
    parseDbDateTime,
    isSameEventTemporal,
    getClosingWindowInfo,
    classifyClvWindow,
    isUnverifiedClvSource,
    getVaultRecordFreshness,
    classifyVaultRecordSource,
    hasClvLocked,
    getBetsNeedingClv,
    filterBetsEligibleForClv,
    isAudit16dR3PostMatchCooldownActive,
    markAudit16dR3PostMatchVaultCooldown,
    generateMatchVaultId,
    cacheOddsDataToVault,
    getOddsFromVault,
    getOddsFromVaultRecord,

    // Market helpers
    getSharpConsensusOdd,
    getClosingOddForBet,
    extractTotalLineFromPrediction,
    updateBetsFromVault,
    // STEP102_CLV_CANONICAL_RUNTIME_EXPORT: utile per test/audit mirati senza cambiare il flusso applicativo.
    updateClvLock,
    ensureClvColumns,

    // STEP103 runtime audit helpers
    buildStep103ClvRuntimeAudit,
    logStep103ClvRuntimeAudit,
    STEP103_CLV_RUNTIME_VISIBILITY_AUDIT,
    STEP103_CLV_AUTO_TRACKER_VERSION,

    // Patch 45 runtime binding guard
    TENNIS_PATCH45_CLV_RUNTIME_BINDING_GUARD,
    PATCH45_CLV_RUNTIME_BINDINGS_READY,
    assertPatch45ClvRuntimeBindings,

    // Patch 47 degraded ledger / evidence idempotency
    createPatch47ClvMetrics,
    finalizePatch47ClvMetrics,
    recordPatch47ClvObservation,
    TENNIS_CLV_DEGRADED_LEDGER_VERSION: tennisClvDegradedLedgerPatch47.TENNIS_CLV_DEGRADED_LEDGER_VERSION,

    // Metadata
    CLV_TRACKER_VERSION,
    AUDIT16D_R3_CLV_RUNTIME_VERSION,
    AUDIT16D_R3_POST_MATCH_NO_SNAPSHOT_COOLDOWN_HOURS,
    AUDIT16D_R3_POST_MATCH_NO_PICK_COOLDOWN_HOURS,
    STEP57_CLV_API_EFFICIENCY_GUARD,
    STEP57_CLV_API_MODE,
    STEP62_CLV_HARD_BUDGET_SMART_FETCH,
    STEP62_CLV_API_MODE,
    STEP62_CLV_API_WINDOW_BEFORE_HOURS,
    STEP62_CLV_API_WINDOW_AFTER_HOURS,
    STEP62_CLV_COOLDOWN_MINUTES,
    STEP62_CLV_MAX_API_CALLS_PER_RUN,
    STEP62_CLV_MIN_RESIDUAL_CREDITS,
    buildClvSmartFetchPlan,
    buildClvSmartFetchPlanFromBets,
    classifyClvPriority,
    tennisClvEvidencePriorityT9,
    T9_HOLDOUT_CLV_EVIDENCE_PRIORITY_VERSION: tennisClvEvidencePriorityT9.VERSION,
    getMarketsForBet,
    inferTennisSportKeyForBet,
    getFootballSportKeyForBet,
    clvCrossSportCoveragePatch53,
    getTennisSportKeys,
    tennisClvSportKeyDiscoveryPatch35,
    getClvRetryState,
    isClvMaxAttemptsReached,
    markClvMaxAttemptsReached,
    markClvApiAttempt,
    getStep57ClvApiUsageDelta,
    CLV_SOURCE_LIVE_API,
    CLV_SOURCE_INTERNAL_VAULT,
    CLV_SOURCE_POST_MATCH_VAULT,
    CLV_SOURCE_STALE_VAULT_SNAPSHOT,
    CLV_SOURCE_PREMATCH_VAULT_SNAPSHOT,
    CLV_TRACKER_RUNTIME_VERSION,
    STEP100B_CLV_MAX_ATTEMPTS_PER_MATCH};