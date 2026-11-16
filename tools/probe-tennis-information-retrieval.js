'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot } = require('./patch52-cli');
const { openDatabase } = require('./patch15-db-adapter');
const retrieval = require('../backend/tennisInformationRetrievalCertification');

(async () => {
  const projectRoot = resolveProjectRoot(process.argv.slice(2), path.join(__dirname, '..'));
  const dbPath = process.env.BETTING_DB_PATH || path.join(projectRoot, 'backend', 'database_betting.db');
  const verifyOnly = process.argv.includes('--verify-only') || process.argv.includes('--offline');
  const { db } = openDatabase(dbPath, { projectRoot, fileMustExist: true });
  try {
    const report = verifyOnly
      ? retrieval.buildInformationRetrievalHealth(db, { dataDir: path.join(projectRoot, 'backend', 'sackmann_data'), cacheDir: path.join(projectRoot, 'backend', 'cache_news'), limit: 12 })
      : await retrieval.runLiveRetrievalProbe(db, { dataDir: path.join(projectRoot, 'backend', 'sackmann_data'), cacheDir: path.join(projectRoot, 'backend', 'cache_news'), persist: true, timeoutMs: 8000 });
    const auditDir = path.join(projectRoot, 'audit_patch15'); fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(path.join(auditDir, verifyOnly ? 'patch15_retrieval_offline_probe.json' : 'patch15_retrieval_live_probe.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (report.status === 'FAIL' || report.status === 'SCHEMA_MISSING') process.exitCode = 2;
  } finally { db.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exit(2); });
