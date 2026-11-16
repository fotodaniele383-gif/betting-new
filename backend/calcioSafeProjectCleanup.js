'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CALCIO_SAFE_CLEANUP_VERSION = 'CALCIO_PATCH_9_SAFE_PROJECT_CLEANUP_V1';

const ZERO_BYTE_SAFE_FILES = Object.freeze([
    'backup/GET',
    'backup/jest',
    'backup/node server.js.txt',
    'backup/calcio_log.txt'
]);

const INLINE_BACKUP_SAFE_MOVES = Object.freeze([
    Object.freeze({ path: 'backend/clvTracker.pre_ATP500_fix.bak', canonical: 'backend/clvTracker.js' }),
    Object.freeze({ path: 'backend/portfolioAuditMetrics.js.backup_step73b_2026-05-29T07-59-54-573Z', canonical: 'backend/portfolioAuditMetrics.js' }),
    Object.freeze({ path: 'backend/server.tennis.js.bak-step79-2026-05-29T15-14-38-951Z', canonical: 'backend/server.tennis.js' })
]);

const NEVER_AUTO_TOUCH = Object.freeze([
    '.env',
    'backend/.env',
    'backend/database_betting.db',
    'backend/backup',
    'backend/backups',
    'backend/cache',
    'backend/cache_news',
    'backend/cache_nlp_calcio',
    'backend/cache_results_tennis_v11',
    'backend/data',
    'backend/logs',
    'backend/ngrok.exe',
    'backend/sackmann_data',
    'Dati statistici Giocatori web_file',
    'audit_calcio_patch8',
    'audit_patch25',
    'audit_calcio_project_state'
]);

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalize(relative = '') {
    return String(relative).replaceAll('\\', '/').replace(/^\/+/, '');
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function pathSizeBytes(target) {
    if (!fs.existsSync(target)) return 0;
    const stat = fs.statSync(target);
    if (stat.isFile()) return stat.size;
    let total = 0;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        total += pathSizeBytes(path.join(target, entry.name));
    }
    return total;
}

function ensureInside(root, target) {
    const resolvedRoot = path.resolve(root);
    const resolvedTarget = path.resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error(`Percorso fuori root non consentito: ${target}`);
    }
}

function parsePatchBackupName(name = '') {
    let match = /^CALCIO_PATCH_(\d+)(?:_R(\d+))?_(.+)$/i.exec(name);
    if (match) return { track: 'CALCIO', version: Number(match[1]), revision: Number(match[2] || 0), suffix: match[3] };
    match = /^TENNIS_PATCH_(\d+)(?:_R(\d+))?_(.+)$/i.exec(name);
    if (match) return { track: 'TENNIS', version: Number(match[1]), revision: Number(match[2] || 0), suffix: match[3] };
    return null;
}

function chooseRetainedBackups(entries = []) {
    const parsed = entries.map(name => ({ name, parsed: parsePatchBackupName(name) })).filter(item => item.parsed);
    const retained = new Set();
    for (const track of ['CALCIO', 'TENNIS']) {
        const items = parsed.filter(item => item.parsed.track === track);
        if (!items.length) continue;
        const highestVersion = Math.max(...items.map(item => item.parsed.version));
        const sameVersion = items.filter(item => item.parsed.version === highestVersion);
        const highestRevision = Math.max(...sameVersion.map(item => item.parsed.revision));
        sameVersion.filter(item => item.parsed.revision === highestRevision).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 1).forEach(item => retained.add(item.name));
        if (track === 'CALCIO' && highestVersion >= 9) {
            const previous = items.filter(item => item.parsed.version === highestVersion - 1).sort((a, b) => b.parsed.revision - a.parsed.revision || b.name.localeCompare(a.name))[0];
            if (previous) retained.add(previous.name);
        }
    }
    return retained;
}

function buildCleanupPlan(root, options = {}) {
    const resolvedRoot = path.resolve(root);
    const backupDir = path.join(resolvedRoot, 'backup');
    const actions = [];
    const retained = [];
    const ambiguous = NEVER_AUTO_TOUCH.map(item => ({ path: item, reason: 'Uso runtime, dati, credenziali, cache operativa o recupero non dimostrabilmente superfluo.' }));

    for (const relative of ZERO_BYTE_SAFE_FILES) {
        const absolute = path.join(resolvedRoot, relative);
        if (!fs.existsSync(absolute)) continue;
        const stat = fs.statSync(absolute);
        if (stat.isFile() && stat.size === 0) actions.push({ type: 'DELETE_ZERO_BYTE', path: normalize(relative), sizeBytes: 0 });
        else ambiguous.push({ path: normalize(relative), reason: 'Nome candidato ma contenuto non vuoto: conservato.' });
    }

    for (const entry of INLINE_BACKUP_SAFE_MOVES) {
        const source = path.join(resolvedRoot, entry.path);
        const canonical = path.join(resolvedRoot, entry.canonical);
        if (!fs.existsSync(source)) continue;
        if (!fs.existsSync(canonical) || !fs.statSync(canonical).isFile()) {
            ambiguous.push({ path: entry.path, reason: `Backup inline conservato: file canonico mancante (${entry.canonical}).` });
            continue;
        }
        actions.push({ type: 'ARCHIVE', path: entry.path, canonical: entry.canonical, sizeBytes: pathSizeBytes(source) });
    }

    if (fs.existsSync(backupDir) && fs.statSync(backupDir).isDirectory()) {
        const names = fs.readdirSync(backupDir).filter(name => fs.statSync(path.join(backupDir, name)).isDirectory());
        const keep = chooseRetainedBackups(names);
        for (const name of names) {
            const parsed = parsePatchBackupName(name);
            if (!parsed) {
                ambiguous.push({ path: normalize(path.join('backup', name)), reason: 'Cartella backup non riconducibile con certezza a una patch versionata.' });
                continue;
            }
            if (keep.has(name)) {
                retained.push({ path: normalize(path.join('backup', name)), reason: `Ultimo backup ${parsed.track} v${parsed.version} R${parsed.revision}.` });
                continue;
            }
            actions.push({
                type: 'ARCHIVE',
                path: normalize(path.join('backup', name)),
                track: parsed.track,
                version: parsed.version,
                revision: parsed.revision,
                sizeBytes: pathSizeBytes(path.join(backupDir, name))
            });
        }
    }

    for (const metadata of ['.DS_Store', 'Thumbs.db', 'desktop.ini']) {
        for (const relativeBase of ['', 'backup', 'backend/backup', 'backend/backups']) {
            const relative = normalize(path.join(relativeBase, metadata));
            const absolute = path.join(resolvedRoot, relative);
            if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
                actions.push({ type: 'DELETE_METADATA', path: relative, sizeBytes: fs.statSync(absolute).size });
            }
        }
    }

    const unique = new Map();
    for (const action of actions) unique.set(`${action.type}:${action.path}`, action);
    const finalActions = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
    return {
        version: CALCIO_SAFE_CLEANUP_VERSION,
        root: resolvedRoot,
        mode: options.apply ? 'APPLY' : 'DRY_RUN',
        generatedAt: new Date().toISOString(),
        actions: finalActions,
        retained,
        ambiguous,
        summary: {
            actionCount: finalActions.length,
            archiveCount: finalActions.filter(item => item.type === 'ARCHIVE').length,
            deleteCount: finalActions.filter(item => item.type.startsWith('DELETE_')).length,
            reclaimableFromProjectBytes: finalActions.reduce((sum, item) => sum + (item.sizeBytes || 0), 0),
            ambiguousCount: ambiguous.length
        },
        safeguards: {
            unknownFilesDeleted: false,
            backendBackupFoldersTouched: false,
            databaseTouched: false,
            envTouched: false,
            cacheTouched: false,
            archiveOutsideProject: true
        }
    };
}

function copyRecursive(source, destination) {
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        for (const entry of fs.readdirSync(source)) copyRecursive(path.join(source, entry), path.join(destination, entry));
    } else {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
    }
}

function movePath(source, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { fs.renameSync(source, destination); }
    catch (error) {
        if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        copyRecursive(source, destination);
        fs.rmSync(source, { recursive: true, force: true });
    }
}

function applyCleanupPlan(root, options = {}) {
    const resolvedRoot = path.resolve(root);
    const plan = buildCleanupPlan(resolvedRoot, { ...options, apply: true });
    const archiveRoot = path.resolve(options.archiveRoot || path.join(path.dirname(resolvedRoot), 'BettingApp_Archive', `CALCIO_PATCH_09_${timestamp()}`));
    if (archiveRoot === resolvedRoot || archiveRoot.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('L’archivio di sicurezza deve essere esterno alla root BettingApp.');
    const completed = [];
    try {
        for (const action of plan.actions) {
            const source = path.join(resolvedRoot, action.path);
            ensureInside(resolvedRoot, source);
            if (!fs.existsSync(source)) continue;
            const destination = path.join(archiveRoot, action.path);
            if (fs.existsSync(destination)) throw new Error(`Destinazione archivio già esistente: ${destination}`);
            const stat = fs.statSync(source);
            const fileSha256 = stat.isFile() ? sha256File(source) : null;
            movePath(source, destination);
            completed.push({ ...action, source, destination, fileSha256 });
        }
    } catch (error) {
        for (const item of [...completed].reverse()) {
            if (item.destination && fs.existsSync(item.destination) && !fs.existsSync(item.source)) movePath(item.destination, item.source);
        }
        throw error;
    }

    const report = {
        ...plan,
        appliedAt: new Date().toISOString(),
        archiveRoot,
        completed,
        summary: {
            ...plan.summary,
            completedCount: completed.length,
            movedOutsideProjectBytes: completed.reduce((sum, item) => sum + (item.sizeBytes || 0), 0),
            deletedBytes: 0
        }
    };
    const reportDir = path.join(resolvedRoot, 'audit_calcio_patch9');
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'calcio_patch9_cleanup_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath };
}

function rollbackCleanup(reportOrPath) {
    const report = typeof reportOrPath === 'string' ? JSON.parse(fs.readFileSync(reportOrPath, 'utf8')) : reportOrPath;
    const restored = [];
    for (const item of [...(report.completed || [])].reverse()) {
        if (!item.destination || !fs.existsSync(item.destination)) continue;
        if (fs.existsSync(item.source)) throw new Error(`Rollback cleanup bloccato: destinazione originale già occupata ${item.source}`);
        movePath(item.destination, item.source);
        restored.push(item.path);
    }
    return { success: true, restored, skippedDeletedMetadata: [] };
}

module.exports = {
    CALCIO_SAFE_CLEANUP_VERSION,
    ZERO_BYTE_SAFE_FILES,
    INLINE_BACKUP_SAFE_MOVES,
    NEVER_AUTO_TOUCH,
    parsePatchBackupName,
    chooseRetainedBackups,
    buildCleanupPlan,
    applyCleanupPlan,
    rollbackCleanup,
    _private: { pathSizeBytes, movePath, copyRecursive, sha256File }
};
