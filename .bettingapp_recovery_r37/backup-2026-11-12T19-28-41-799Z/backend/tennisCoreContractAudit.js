'use strict';

const fs = require('fs');
const path = require('path');

const TENNIS_CORE_CONTRACT_AUDIT_VERSION = 'TENNIS_CORE_CONTRACT_AUDIT_V1_PATCH30';
const AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION = 'AUDIT16D_R3_T1_TENNIS_HEALTH_AND_FORWARD_DATA_V1';
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  'node_modules', '.git', '.betting_patch_backups', 'backup', 'backups', 'coverage'
]);

function toPosix(value) {
  return String(value || '').split(path.sep).join('/');
}

function fileExistsAsModule(basePath) {
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.json`,
    `${basePath}.node`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.json')
  ];
  return candidates.some(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function extractNodeTargets(command = '') {
  const targets = [];
  const regex = /(?:^|&&|\|\||;)\s*node\s+(?:"([^"]+\.js)"|'([^']+\.js)'|([^\s;&|]+\.js))/g;
  let match;
  while ((match = regex.exec(String(command)))) targets.push(match[1] || match[2] || match[3]);
  return targets;
}

function extractJestTargets(command = '') {
  if (!/(?:^|\s)jest(?:\s|$)/.test(String(command))) return [];
  const targets = [];
  const regex = /(?:^|\s)([A-Za-z0-9_./\\-]+\.(?:js|cjs|mjs))(?:\s|$)/g;
  let match;
  while ((match = regex.exec(String(command)))) targets.push(match[1]);
  return targets;
}

function extractNpmRunTargets(command = '') {
  return [...String(command).matchAll(/npm\s+run\s+([A-Za-z0-9:_-]+)/g)].map(match => match[1]);
}

function inspectPackageScripts(projectRoot) {
  const packagePath = path.join(projectRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const scripts = pkg.scripts || {};
  const missingFileTargets = [];
  const missingScriptReferences = [];
  const checkedFileTargets = [];

  for (const [scriptName, command] of Object.entries(scripts)) {
    const fileTargets = [
      ...extractNodeTargets(command).map(target => ({ type: 'node', target })),
      ...extractJestTargets(command).map(target => ({ type: 'jest', target }))
    ];
    for (const item of fileTargets) {
      const absolute = path.resolve(projectRoot, item.target);
      const exists = fs.existsSync(absolute) && fs.statSync(absolute).isFile();
      checkedFileTargets.push({ scriptName, ...item, exists });
      if (!exists) missingFileTargets.push({ scriptName, ...item });
    }
    for (const referencedScript of extractNpmRunTargets(command)) {
      if (!Object.prototype.hasOwnProperty.call(scripts, referencedScript)) {
        missingScriptReferences.push({ scriptName, referencedScript });
      }
    }
  }

  return {
    packageVersion: pkg.version || null,
    scriptCount: Object.keys(scripts).length,
    checkedFileTargets,
    missingFileTargets,
    missingScriptReferences,
    healthy: missingFileTargets.length === 0 && missingScriptReferences.length === 0
  };
}

function walkRuntimeJavaScript(projectRoot, relativeRoot, output = []) {
  const absoluteRoot = path.join(projectRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return output;
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nextRelative = toPosix(path.join(relativeRoot, entry.name));
      const historicalAuditTree = /^config\/AUDIT(?:\d|[A-Z_])/i.test(nextRelative)
        || /^config\/archive(?:\/|$)/i.test(nextRelative)
        || /^config\/backups?(?:\/|$)/i.test(nextRelative);
      if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name) || /^TENNIS_PATCH_/i.test(entry.name) || historicalAuditTree) continue;
      walkRuntimeJavaScript(projectRoot, path.join(relativeRoot, entry.name), output);
      continue;
    }
    if (!/\.(?:js|cjs|mjs)$/.test(entry.name)) continue;
    if (/\.test\.(?:js|cjs|mjs)$/.test(entry.name)) continue;
    output.push(path.join(relativeRoot, entry.name));
  }
  return output;
}

function inspectRuntimeDependencies(projectRoot) {
  const files = [
    ...walkRuntimeJavaScript(projectRoot, 'backend'),
    ...walkRuntimeJavaScript(projectRoot, 'config')
  ];
  const missing = [];
  const checked = [];
  const patterns = [
    /require\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /\bfrom\s+['"](\.[^'"]+)['"]/g
  ];

  for (const relativeFile of files) {
    const absoluteFile = path.join(projectRoot, relativeFile);
    const source = fs.readFileSync(absoluteFile, 'utf8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) {
        const request = match[1];
        const resolvedBase = path.resolve(path.dirname(absoluteFile), request);
        const exists = fileExistsAsModule(resolvedBase);
        const item = { file: toPosix(relativeFile), request, exists };
        checked.push(item);
        if (!exists) missing.push(item);
      }
    }
  }

  return { fileCount: files.length, dependencyCount: checked.length, checked, missing, healthy: missing.length === 0 };
}

function findDuplicateFunctionDeclarations(source = '') {
  const counts = new Map();
  const regex = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let match;
  while ((match = regex.exec(String(source)))) {
    const name = match[1];
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));
}

function parseRequireAliases(source = '') {
  const aliases = [];
  const regex = /^\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](\.[^'"]+)['"]\s*\)\s*;?/gm;
  let match;
  while ((match = regex.exec(String(source)))) aliases.push({ alias: match[1], request: match[2] });
  return aliases;
}

function buildRouteDependencyMap(serverSource = '') {
  const aliases = parseRequireAliases(serverSource);
  const routeRegex = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  const routes = [];
  let match;
  while ((match = routeRegex.exec(serverSource))) {
    routes.push({ method: match[1].toUpperCase(), route: match[2], start: match.index });
  }
  return routes.map((route, index) => {
    const end = index + 1 < routes.length ? routes[index + 1].start : serverSource.length;
    const body = serverSource.slice(route.start, end);
    const dependencies = aliases
      .filter(item => new RegExp(`\\b${item.alias}\\b`).test(body))
      .map(item => ({ alias: item.alias, module: item.request }));
    return { method: route.method, route: route.route, dependencies };
  });
}

function buildCoreContractAudit(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const serverPath = path.join(projectRoot, 'backend', 'server.tennis.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const packageScripts = inspectPackageScripts(projectRoot);
  const runtimeDependencies = inspectRuntimeDependencies(projectRoot);
  const duplicateFunctionDeclarations = findDuplicateFunctionDeclarations(serverSource);
  const routeDependencyMap = buildRouteDependencyMap(serverSource);
  const coreRoute = routeDependencyMap.find(item => item.route === '/core-contract-health');
  const coreRouteLinked = Boolean(coreRoute?.dependencies?.some(item => item.alias === 'tennisCoreContractAudit'));
  const healthy = packageScripts.healthy
    && runtimeDependencies.healthy
    && duplicateFunctionDeclarations.length === 0
    && coreRouteLinked;

  return {
    success: healthy,
    healthy,
    status: healthy ? 'OK' : 'ERROR',
    version: TENNIS_CORE_CONTRACT_AUDIT_VERSION,
    healthHardeningRevision: AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
    readOnly: true,
    projectRoot,
    packageScripts,
    runtimeDependencies,
    duplicateFunctionDeclarations,
    routeDependencyMap,
    routeContract: {
      route: '/api/tennis/core-contract-health',
      linked: coreRouteLinked,
      dependencyCount: coreRoute?.dependencies?.length || 0
    },
    authority: {
      productionProbability: false,
      qualityGate: false,
      stake: false,
      settlement: false,
      clv: false
    },
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  TENNIS_CORE_CONTRACT_AUDIT_VERSION,
  AUDIT16D_R3_T1_HEALTH_HARDENING_REVISION,
  extractNodeTargets,
  extractJestTargets,
  extractNpmRunTargets,
  inspectPackageScripts,
  inspectRuntimeDependencies,
  findDuplicateFunctionDeclarations,
  buildRouteDependencyMap,
  buildCoreContractAudit
};
