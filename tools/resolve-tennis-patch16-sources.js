'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CANONICAL_XLSX = 'Dati statistici Giocatori.xlsx';
const CANONICAL_WEB_DIR = 'Dati statistici Giocatori web_file';
const CANONICAL_PDF = 'Dati statistici Giocatori pdf.pdf';
const REQUIRED_HTML = Object.freeze(['sheet001.htm', 'sheet002.htm', 'sheet003.htm']);
const MAX_DISCOVERY_DEPTH = 4;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function normalizeKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function dedupe(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (!item) continue;
    const resolved = path.resolve(item);
    const key = normalizeKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(resolved);
  }
  return output;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function excludedDirectory(name) {
  const value = String(name || '').toLowerCase();
  return value === 'node_modules'
    || value === '.git'
    || value === 'backup'
    || value === 'data'
    || value.startsWith('audit_patch')
    || value.startsWith('tennis_patch_');
}

function walkDirectories(root, maxDepth = MAX_DISCOVERY_DEPTH) {
  const output = [];
  const queue = [{ directory: path.resolve(root), depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    output.push(current.directory);
    if (current.depth >= maxDepth) continue;
    let entries = [];
    try { entries = fs.readdirSync(current.directory, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || excludedDirectory(entry.name)) continue;
      const child = path.join(current.directory, entry.name);
      if (isInside(root, child)) queue.push({ directory: child, depth: current.depth + 1 });
    }
  }
  return output;
}

function findNamedFiles(root, basename) {
  const found = [];
  for (const directory of walkDirectories(root)) {
    const candidate = path.join(directory, basename);
    try {
      if (fs.statSync(candidate).isFile()) found.push(candidate);
    } catch (_) { /* absent */ }
  }
  return dedupe(found);
}

function hasRequiredHtml(directory) {
  try {
    return fs.statSync(directory).isDirectory()
      && REQUIRED_HTML.every(file => fs.statSync(path.join(directory, file)).isFile());
  } catch (_) {
    return false;
  }
}

function findHtmlDirectories(root) {
  return dedupe(walkDirectories(root).filter(hasRequiredHtml));
}

function chooseFile(label, candidates, { required = true } = {}) {
  const existing = dedupe(candidates).filter(candidate => {
    try { return fs.statSync(candidate).isFile(); }
    catch (_) { return false; }
  });
  if (!existing.length) {
    if (!required) return { path: null, duplicates: [], identicalDuplicates: false };
    throw new Error(`${label} mancante. Percorsi controllati:\n- ${dedupe(candidates).join('\n- ')}`);
  }
  const byHash = new Map();
  for (const file of existing) {
    const digest = sha256File(file);
    if (!byHash.has(digest)) byHash.set(digest, []);
    byHash.get(digest).push(file);
  }
  if (byHash.size > 1) {
    throw new Error(`${label} ambiguo: trovate copie con contenuto diverso. Mantieni una sola versione oppure usa l'opzione esplicita --source/--pdf.\n- ${existing.join('\n- ')}`);
  }
  return { path: existing[0], duplicates: existing.slice(1), identicalDuplicates: existing.length > 1 };
}

function directoryDigest(directory) {
  const hash = crypto.createHash('sha256');
  for (const file of REQUIRED_HTML) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(directory, file)));
  }
  return hash.digest('hex');
}

function chooseWebDirectory(candidates) {
  const existing = dedupe(candidates).filter(hasRequiredHtml);
  if (!existing.length) {
    throw new Error(`Sorgente HTML mancante. Servono ${REQUIRED_HTML.join(', ')} nella stessa cartella. Percorsi controllati:\n- ${dedupe(candidates).join('\n- ')}`);
  }
  const byHash = new Map();
  for (const directory of existing) {
    const digest = directoryDigest(directory);
    if (!byHash.has(digest)) byHash.set(digest, []);
    byHash.get(digest).push(directory);
  }
  if (byHash.size > 1) {
    throw new Error(`Cartella HTML ambigua: trovate esportazioni con contenuto diverso. Mantieni una sola versione oppure usa --web-dir.\n- ${existing.join('\n- ')}`);
  }
  return { path: existing[0], duplicates: existing.slice(1), identicalDuplicates: existing.length > 1 };
}

function explicitPath(root, value, label, type) {
  if (!value) return null;
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!isInside(root, resolved)) throw new Error(`${label} deve trovarsi dentro la root del progetto: ${resolved}`);
  let stat;
  try { stat = fs.statSync(resolved); }
  catch (_) { throw new Error(`${label} esplicito non trovato: ${resolved}`); }
  if (type === 'file' && !stat.isFile()) throw new Error(`${label} non è un file: ${resolved}`);
  if (type === 'directory' && !stat.isDirectory()) throw new Error(`${label} non è una cartella: ${resolved}`);
  return resolved;
}

function detectLayout(root, sourceFile, webDir) {
  const rootResolved = path.resolve(root);
  const canonicalRoot = path.join(rootResolved, CANONICAL_XLSX);
  const canonicalNested = path.join(rootResolved, CANONICAL_WEB_DIR, CANONICAL_XLSX);
  if (normalizeKey(sourceFile) === normalizeKey(canonicalRoot)) return 'STANDARD_ROOT_XLSX_PLUS_WEB_FOLDER';
  if (normalizeKey(sourceFile) === normalizeKey(canonicalNested)) return 'UNIFIED_WEB_FOLDER_WITH_XLSX';
  if (normalizeKey(path.dirname(sourceFile)) === normalizeKey(webDir)) return 'DISCOVERED_XLSX_AND_HTML_SAME_FOLDER';
  return 'DISCOVERED_SAFE_LOCAL_LAYOUT';
}

function resolvePatch16Sources(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const explicitSource = explicitPath(root, options.sourceFile, 'Sorgente XLSX', 'file');
  const sourceCandidates = explicitSource ? [explicitSource] : [
    path.join(root, CANONICAL_XLSX),
    path.join(root, CANONICAL_WEB_DIR, CANONICAL_XLSX),
    ...findNamedFiles(root, CANONICAL_XLSX)
  ];
  const sourceChoice = chooseFile('Sorgente XLSX', sourceCandidates);

  const explicitWeb = explicitPath(root, options.webDir, 'Cartella HTML', 'directory');
  if (explicitWeb && !hasRequiredHtml(explicitWeb)) {
    throw new Error(`Cartella HTML incompleta: ${explicitWeb}. Richiesti: ${REQUIRED_HTML.join(', ')}`);
  }
  const webCandidates = explicitWeb ? [explicitWeb] : [
    path.join(root, CANONICAL_WEB_DIR),
    path.dirname(sourceChoice.path),
    ...findHtmlDirectories(root)
  ];
  const webChoice = chooseWebDirectory(webCandidates);

  const explicitPdf = explicitPath(root, options.pdfFile, 'PDF audit-only', 'file');
  const pdfCandidates = explicitPdf ? [explicitPdf] : [
    path.join(root, CANONICAL_PDF),
    path.join(path.dirname(sourceChoice.path), CANONICAL_PDF),
    path.join(webChoice.path, CANONICAL_PDF),
    ...findNamedFiles(root, CANONICAL_PDF)
  ];
  const pdfChoice = chooseFile('PDF audit-only', pdfCandidates, { required: false });

  return {
    root,
    sourceFile: sourceChoice.path,
    webDir: webChoice.path,
    pdfFile: pdfChoice.path || path.join(root, CANONICAL_PDF),
    pdfPresent: Boolean(pdfChoice.path),
    layout: detectLayout(root, sourceChoice.path, webChoice.path),
    requiredHtmlFiles: [...REQUIRED_HTML],
    sourceIdenticalDuplicates: sourceChoice.duplicates,
    webIdenticalDuplicates: webChoice.duplicates,
    pdfIdenticalDuplicates: pdfChoice.duplicates,
    discoveryPolicy: 'LOCAL_EXACT_NAME_MAX_DEPTH_4_FAIL_CLOSED_ON_DIFFERENT_CONTENT'
  };
}

module.exports = {
  CANONICAL_XLSX,
  CANONICAL_WEB_DIR,
  CANONICAL_PDF,
  REQUIRED_HTML,
  resolvePatch16Sources,
  hasRequiredHtml
};
