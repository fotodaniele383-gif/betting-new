// ============================================================================
// AI BETTING QUANT PRO - SAFE SQL MIGRATION EXECUTOR
// File: backend/safeMigrationExecutor.js
// Versione: 1.1
// ============================================================================
//
// SCOPO
// - Eseguire in modo controllato il piano SQL generato dal Migration Planner.
// - Default: DRY RUN, nessuna modifica al DB.
// - Esecuzione reale solo con --apply.
// - Crea backup automatico prima di applicare.
// - Valida che il SQL contenga solo istruzioni ammesse.
// - Blocca istruzioni pericolose.
// - Blocca riferimenti Tennis.
// - Verifica che gli UPDATE abbiano filtri di sicurezza.
//
// USO
// Dry run:
// node backend/safeMigrationExecutor.js --db=backend/database_betting.db --sql=football_legacy_dirty_plan.sql
//
// Apply reale:
// node backend/safeMigrationExecutor.js --db=backend/database_betting.db --sql=football_legacy_dirty_plan.sql --apply
//
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

const SAFE_MIGRATION_EXECUTOR_VERSION = '1.1';

const ALLOWED_TABLE = 'ai_forward_test';
const REQUIRED_MARKER = 'FOOTBALL DATA QUALITY MIGRATION SQL';
const REQUIRED_GENERATOR = 'footballDataQualityMigrationPlanner.js';
const BACKUP_SUFFIX = 'BACKUP_pre_safe_migration';

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value);
}

function nowStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
        d.getFullYear(),
        pad(d.getMonth() + 1),
        pad(d.getDate()),
        '_',
        pad(d.getHours()),
        pad(d.getMinutes()),
        pad(d.getSeconds())
    ].join('');
}

function stripSqlComments(sql) {
    return safeString(sql)
        .split(/\r?\n/)
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim();
}

function splitSqlStatements(sql) {
    return stripSqlComments(sql)
        .split(';')
        .map(s => s.trim())
        .filter(Boolean);
}

function extractUpdateStatements(sql) {
    return splitSqlStatements(sql).filter(stmt => /^UPDATE\s+/i.test(stmt));
}

function hasForbiddenStatement(statement) {
    return /\b(DROP|ALTER|CREATE|DELETE|INSERT|REPLACE|TRUNCATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i.test(statement);
}

function validateSqlText(sqlText) {
    const sql = safeString(sqlText);
    const errors = [];
    const warnings = [];

    if (!sql.includes(REQUIRED_MARKER)) {
        errors.push('MISSING_REQUIRED_MIGRATION_MARKER');
    }

    if (!sql.includes(REQUIRED_GENERATOR)) {
        errors.push('MISSING_REQUIRED_GENERATOR_MARKER');
    }

    if (!/\bBEGIN\s+TRANSACTION\b/i.test(sql)) {
        errors.push('MISSING_BEGIN_TRANSACTION');
    }

    if (!/\bCOMMIT\b/i.test(sql)) {
        errors.push('MISSING_COMMIT');
    }

    const statements = splitSqlStatements(sql);

    if (statements.length === 0) {
        errors.push('NO_SQL_STATEMENTS');
    }

    statements.forEach((stmt, idx) => {
        const normalized = stmt.replace(/\s+/g, ' ').trim();

        if (/^BEGIN\s+TRANSACTION$/i.test(normalized)) return;
        if (/^COMMIT$/i.test(normalized)) return;

        if (!/^UPDATE\s+ai_forward_test\s+SET\s+/i.test(normalized)) {
            errors.push(`STATEMENT_${idx + 1}_NOT_ALLOWED`);
            return;
        }

        if (hasForbiddenStatement(normalized.replace(/^UPDATE\s+ai_forward_test\s+SET\s+/i, ''))) {
            errors.push(`STATEMENT_${idx + 1}_HAS_FORBIDDEN_KEYWORD`);
        }

        const requiredSnippets = [
            "data_quality = 'LEGACY_DIRTY'",
            "WHERE id IN",
            "UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'",
            "UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'",
            "COALESCE(data_quality, '') = ''"
        ];

        requiredSnippets.forEach(snippet => {
            if (!normalized.includes(snippet)) {
                errors.push(`STATEMENT_${idx + 1}_MISSING_${snippet}`);
            }
        });

        if (!normalized.includes("UPPER(COALESCE(sport_type, 'CALCIO')) IN ('CALCIO', 'FOOTBALL', 'SOCCER', '')")) {
            warnings.push(`STATEMENT_${idx + 1}_SPORT_FILTER_NOT_EXACT_MATCH`);
        }
    });

    const updateStatements = extractUpdateStatements(sql);

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        statementCount: statements.length,
        updateCount: updateStatements.length,
        allowedTable: ALLOWED_TABLE,
        markers: {
            requiredMarker: sql.includes(REQUIRED_MARKER),
            requiredGenerator: sql.includes(REQUIRED_GENERATOR)
        }
    };
}

function createBackup(dbPath, options = {}) {
    const resolvedDbPath = path.resolve(process.cwd(), dbPath);

    if (!fs.existsSync(resolvedDbPath)) {
        throw new Error(`DB non trovato: ${resolvedDbPath}`);
    }

    const dir = path.dirname(resolvedDbPath);
    const ext = path.extname(resolvedDbPath) || '.db';
    const baseName = path.basename(resolvedDbPath, ext);
    const backupPath = options.backupPath
        ? path.resolve(process.cwd(), options.backupPath)
        : path.join(dir, `${baseName}_${BACKUP_SUFFIX}_${nowStamp()}${ext}`);

    fs.copyFileSync(resolvedDbPath, backupPath);

    return backupPath;
}

function tryLoadBetterSqlite3() {
    try {
        return require('better-sqlite3');
    } catch (error) {
        throw new Error('Modulo better-sqlite3 non disponibile. Eseguire dentro il progetto backend con dipendenze installate.');
    }
}

function runValidationQueries(db) {
    const counts = {};

    try {
        counts.byDataQuality = db.prepare(`
            SELECT COALESCE(data_quality, '') AS data_quality, COUNT(*) AS count
            FROM ai_forward_test
            GROUP BY COALESCE(data_quality, '')
            ORDER BY count DESC
        `).all();
    } catch (error) {
        counts.byDataQuality = [];
    }

    try {
        counts.tennisTouchedRisk = db.prepare(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE COALESCE(data_quality, '') = 'LEGACY_DIRTY'
              AND (
                    UPPER(COALESCE(sport_type, '')) = 'TENNIS'
                    OR UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
                    OR UPPER(COALESCE(strategy_tag, '')) LIKE '%TENNIS%'
              )
        `).get().count;
    } catch (error) {
        counts.tennisTouchedRisk = null;
    }

    try {
        counts.footballLegacyDirty = db.prepare(`
            SELECT COUNT(*) AS count
            FROM ai_forward_test
            WHERE COALESCE(data_quality, '') = 'LEGACY_DIRTY'
              AND (
                    sport_type IS NULL
                    OR UPPER(COALESCE(sport_type, 'CALCIO')) IN ('CALCIO', 'FOOTBALL', 'SOCCER', '')
              )
              AND UPPER(COALESCE(bet_type, '')) NOT LIKE '%TENNIS%'
              AND UPPER(COALESCE(strategy_tag, '')) NOT LIKE '%TENNIS%'
        `).get().count;
    } catch (error) {
        counts.footballLegacyDirty = null;
    }

    return counts;
}

function executeSql(db, sqlText) {
    const statements = splitSqlStatements(sqlText);

    // Il file SQL generato dal planner contiene già BEGIN TRANSACTION e COMMIT.
    // In v1.0 veniva eseguito dentro db.transaction(), causando:
    // "cannot start a transaction within a transaction".
    //
    // In v1.1 eseguiamo direttamente gli statement validati nell'ordine del file.
    // La transazione resta comunque garantita dal BEGIN/COMMIT presenti nel SQL.
    try {
        statements.forEach(stmt => {
            db.prepare(stmt).run();
        });

        return {
            executedStatements: statements.length,
            executedUpdates: statements.filter(stmt => /^UPDATE\s+/i.test(stmt)).length,
            transactionMode: 'SQL_FILE_TRANSACTION'
        };
    } catch (error) {
        // Se il file ha aperto una transazione e fallisce prima del COMMIT,
        // tentiamo rollback difensivo.
        try { db.prepare('ROLLBACK').run(); } catch (_) {}
        throw error;
    }
}

function runMigration(options = {}) {
    const dbPath = options.db;
    const sqlPath = options.sql;
    const apply = options.apply === true;

    if (!dbPath) throw new Error('Parametro --db obbligatorio.');
    if (!sqlPath) throw new Error('Parametro --sql obbligatorio.');

    const resolvedDbPath = path.resolve(process.cwd(), dbPath);
    const resolvedSqlPath = path.resolve(process.cwd(), sqlPath);

    if (!fs.existsSync(resolvedDbPath)) {
        throw new Error(`DB non trovato: ${resolvedDbPath}`);
    }

    if (!fs.existsSync(resolvedSqlPath)) {
        throw new Error(`SQL non trovato: ${resolvedSqlPath}`);
    }

    const sqlText = fs.readFileSync(resolvedSqlPath, 'utf8');
    const validation = validateSqlText(sqlText);

    const result = {
        success: false,
        version: SAFE_MIGRATION_EXECUTOR_VERSION,
        mode: apply ? 'APPLY' : 'DRY_RUN',
        readOnly: !apply,
        dbPath: resolvedDbPath,
        sqlPath: resolvedSqlPath,
        validation,
        backupPath: null,
        before: null,
        after: null,
        execution: null,
        message: ''
    };

    if (!validation.ok) {
        result.message = 'SQL non valido. Nessuna modifica eseguita.';
        return result;
    }

    const Database = tryLoadBetterSqlite3();

    if (!apply) {
        const db = new Database(resolvedDbPath, { readonly: true });
        try {
            result.before = runValidationQueries(db);
            result.success = true;
            result.message = 'DRY RUN completato. Nessuna modifica eseguita.';
            return result;
        } finally {
            try { db.close(); } catch (_) {}
        }
    }

    const backupPath = createBackup(resolvedDbPath, { backupPath: options.backupPath });
    result.backupPath = backupPath;

    const db = new Database(resolvedDbPath);
    try {
        result.before = runValidationQueries(db);
        result.execution = executeSql(db, sqlText);
        result.after = runValidationQueries(db);

        if (result.after && result.after.tennisTouchedRisk && result.after.tennisTouchedRisk > 0) {
            throw new Error(`Sicurezza fallita: risultano righe Tennis marcate LEGACY_DIRTY (${result.after.tennisTouchedRisk}). Ripristinare backup: ${backupPath}`);
        }

        result.success = true;
        result.message = 'Migrazione applicata con backup automatico.';
        return result;
    } finally {
        try { db.close(); } catch (_) {}
    }
}

function parseCliArgs(argv = process.argv.slice(2)) {
    const args = {
        db: null,
        sql: null,
        apply: false,
        json: false,
        backupPath: null
    };

    argv.forEach(arg => {
        if (arg.startsWith('--db=')) args.db = arg.slice('--db='.length);
        else if (arg.startsWith('--sql=')) args.sql = arg.slice('--sql='.length);
        else if (arg === '--apply') args.apply = true;
        else if (arg === '--json') args.json = true;
        else if (arg.startsWith('--backup=')) args.backupPath = arg.slice('--backup='.length);
    });

    return args;
}

function formatResultText(result) {
    const lines = [
        '',
        '============================================================',
        ` SAFE MIGRATION EXECUTOR v${result.version}`,
        '============================================================',
        `Mode: ${result.mode}`,
        `Success: ${result.success}`,
        `Message: ${result.message}`,
        `DB: ${result.dbPath}`,
        `SQL: ${result.sqlPath}`,
        `Backup: ${result.backupPath || '-'}`,
        '',
        'VALIDATION',
        `- ok: ${result.validation.ok}`,
        `- statements: ${result.validation.statementCount}`,
        `- updates: ${result.validation.updateCount}`,
        `- errors: ${result.validation.errors.length ? result.validation.errors.join(', ') : '0'}`,
        `- warnings: ${result.validation.warnings.length ? result.validation.warnings.join(', ') : '0'}`
    ];

    if (result.before) {
        lines.push('');
        lines.push('BEFORE');
        lines.push(JSON.stringify(result.before, null, 2));
    }

    if (result.execution) {
        lines.push('');
        lines.push('EXECUTION');
        lines.push(JSON.stringify(result.execution, null, 2));
    }

    if (result.after) {
        lines.push('');
        lines.push('AFTER');
        lines.push(JSON.stringify(result.after, null, 2));
    }

    lines.push('');
    return lines.join('\n');
}

function runCli() {
    try {
        const args = parseCliArgs();
        const result = runMigration(args);

        if (args.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(formatResultText(result));
        }

        if (!result.success) process.exitCode = 1;
    } catch (error) {
        const payload = {
            success: false,
            version: SAFE_MIGRATION_EXECUTOR_VERSION,
            message: error.message
        };

        if (process.argv.includes('--json')) {
            console.error(JSON.stringify(payload, null, 2));
        } else {
            console.error(`❌ ${error.message}`);
        }

        process.exitCode = 1;
    }
}

if (require.main === module) {
    runCli();
}

module.exports = {
    SAFE_MIGRATION_EXECUTOR_VERSION,
    validateSqlText,
    splitSqlStatements,
    extractUpdateStatements,
    createBackup,
    runValidationQueries,
    executeSql,
    runMigration,
    parseCliArgs,
    formatResultText
};
