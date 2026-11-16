// ============================================================================
// STEP115/116/117 - BETTINGAPP PORTABILITY AUDIT
// Obiettivo: bloccare path assoluti locali del vecchio PC nei file attivi.
// Questo file è volutamente standalone: nessuna dipendenza esterna, nessun runtime betting modificato.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN_PATTERNS = [
  { label: 'old root raw', pattern: /C:\\Users\\pc-user\\OneDrive\\Personale\\BettingApp/ig },
  { label: 'old backend raw', pattern: /C:\\Users\\pc-user\\OneDrive\\Personale\\BettingApp\\backend/ig },
  { label: 'old root slash', pattern: /C:\/Users\/pc-user\/OneDrive\/Personale\/BettingApp/ig },
  { label: 'old backend slash', pattern: /C:\/Users\/pc-user\/OneDrive\/Personale\/BettingApp\/backend/ig },
  { label: 'old root js escaped', pattern: /C:\\\\Users\\\\pc-user\\\\OneDrive\\\\Personale\\\\BettingApp/ig },
  { label: 'old backend js escaped', pattern: /C:\\\\Users\\\\pc-user\\\\OneDrive\\\\Personale\\\\BettingApp\\\\backend/ig }
];

const SCANNED_EXTENSIONS = new Set([
  '.js', '.json', '.cmd', '.bat', '.html', '.css', '.mjs', '.cjs', '.env', '.txt'
]);

const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg', '.vscode', '.idea',
  'coverage', 'dist', 'build', '.next', '.cache'
]);

function norm(value) {
  return String(value || '').replace(/\\/g, '/');
}

function isIgnoredPath(absPath) {
  const rel = norm(path.relative(ROOT, absPath));
  if (!rel || rel === '.') return false;

  const parts = rel.split('/').filter(Boolean);
  if (parts.some(part => IGNORED_DIR_NAMES.has(part))) return true;

  // Esclude patch e backup generati dagli step: non sono runtime attivo e spesso contengono
  // path storici nei manifest/log di sicurezza.
  if (parts.some(part => /^STEP\d+_.*PATCH$/i.test(part))) return true;
  if (parts.some(part => /^STEP\d+_.*BACKUP/i.test(part))) return true;
  if (parts.some(part => /^BACKUP/i.test(part))) return true;

  // Log/test incollati nella root non devono influenzare la portabilità del programma.
  const fileName = parts[parts.length - 1] || '';
  if (/^Pasted text\(/i.test(fileName)) return true;
  if (/^step\d+_test_output\.txt$/i.test(fileName)) return true;

  return false;
}

function walk(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isIgnoredPath(full)) continue;
    if (entry.isDirectory()) {
      walk(full, output);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SCANNED_EXTENSIONS.has(ext)) output.push(full);
    }
  }
  return output;
}

function collectForbiddenPathHits() {
  const hits = [];
  const files = walk(ROOT);

  for (const file of files) {
    const rel = norm(path.relative(ROOT, file));
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      hits.push({ file: rel, line: 0, pattern: 'READ_ERROR', error: error.message });
      continue;
    }

    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      for (const rule of FORBIDDEN_PATTERNS) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(lineText)) {
          hits.push({ file: rel, line: idx + 1, pattern: rule.label });
        }
      }
    });
  }

  return hits;
}

function collectSyntaxTargets() {
  const preferred = [
    'backend/server.js',
    'backend/server.tennis.js',
    'backend/deepScanTennis.js',
    'backend/clvTracker.js',
    'tools/test-step115-portability-no-absolute-paths.js'
  ];
  return preferred
    .map(rel => path.join(ROOT, rel))
    .filter(file => fs.existsSync(file));
}

function runCli() {
  console.log('=== STEP115/116/117_PORTABILITY_NO_ABSOLUTE_PATHS ===');
  console.log('Root audit:', ROOT);

  const hits = collectForbiddenPathHits();
  if (hits.length > 0) {
    console.error('\nPATH ASSOLUTI VIETATI TROVATI:');
    hits.forEach(hit => {
      console.error(`- ${hit.file}:${hit.line} [${hit.pattern}]${hit.error ? ' ' + hit.error : ''}`);
    });
    console.error('\nCorrezione consigliata: usare path.join(__dirname, ...), path.resolve(process.cwd(), ...) o BETTINGAPP_DB_PATH.');
    process.exitCode = 1;
    return;
  }

  console.log('PASS nessun vecchio path assoluto hardcoded nei file attivi');
  console.log('PASS root audit dinamica:', ROOT);
  console.log('PASS file attivi scansionati con esclusione di backup/patch/log');
  console.log('STEP117 portability audit complete: progetto pronto al controllo su altro PC.');
}

if (require.main === module) {
  runCli();
}

module.exports = {
  ROOT,
  FORBIDDEN_PATTERNS,
  collectForbiddenPathHits,
  collectSyntaxTargets,
  isIgnoredPath,
  walk
};
