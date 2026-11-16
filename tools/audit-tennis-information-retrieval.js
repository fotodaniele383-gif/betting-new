'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectRoot } = require('./patch52-cli');
const { openDatabase } = require('./patch15-db-adapter');
const retrieval = require('../backend/tennisInformationRetrievalCertification');

const projectRoot = resolveProjectRoot(process.argv.slice(2), path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(projectRoot, 'backend', 'database_betting.db');
const { db } = openDatabase(dbPath, { projectRoot, readonly: true, fileMustExist: true });
try {
  const report = retrieval.buildInformationRetrievalHealth(db, { dataDir: path.join(projectRoot, 'backend', 'sackmann_data'), cacheDir: path.join(projectRoot, 'backend', 'cache_news'), limit: 12 });
  const auditDir = path.join(projectRoot, 'audit_patch15'); fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'patch15_information_retrieval_audit.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.status === 'FAIL' || report.status === 'SCHEMA_MISSING') process.exitCode = 2;
} finally { db.close(); }
