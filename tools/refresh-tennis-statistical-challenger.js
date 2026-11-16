'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const challenger = require('../backend/tennisStatisticalChallenger');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const db = new Database(path.join(root, 'backend', 'database_betting.db'), { fileMustExist: true });
try {
  const report = challenger.runStatisticalChallengerAudit(db, { persist: true, includePredictions: true });
  const output = { success: true, patch: '18', refreshedAt: new Date().toISOString(), report, authority: report.authority };
  const dir = path.join(root, 'audit_patch18'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'patch18_refresh_report.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
} finally { db.close(); }
