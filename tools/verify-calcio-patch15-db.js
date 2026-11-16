'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const audit = require('../backend/calcioStakePortfolioAudit');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbFile = path.join(root, 'backend', 'database_betting.db');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(dbFile)).digest('hex');
const before = sha();
const db = new DatabaseSync(dbFile, { readOnly:true });
const tables = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table'`).get().c;
const totalRows = db.prepare(`SELECT COUNT(*) AS c FROM ai_forward_test`).get().c;
const tennisRows = db.prepare(`SELECT COUNT(*) AS c FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'`).get().c;
const activeDuplicateGroups = db.prepare(`
 SELECT COUNT(*) AS c FROM (
   SELECT COALESCE(paper_result_key, match_exposure_key || '|' || prediction) AS k, COUNT(*) AS n
   FROM ai_forward_test
   WHERE COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0
   GROUP BY k HAVING k IS NOT NULL AND k<>'' AND n>1
 )
`).get().c;
const pendingCalcio = db.prepare(`
 SELECT * FROM ai_forward_test
 WHERE status='PENDING' AND UPPER(COALESCE(sport_type,''))='CALCIO'
   AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0
   AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR')
`).all();
const stakeDiagnostics = audit.buildStakeDiagnostics(pendingCalcio);
db.close();
const after = sha();
assert.equal(before, after, 'Il DB è stato modificato dalla verifica');
assert.equal(activeDuplicateGroups, 0, 'Revisioni attive duplicate rilevate');
console.log(JSON.stringify({ success:true, patch:'BETTING_PATCH_15_STAKE_EXECUTION_DS_GATE_PORTFOLIO_AUDIT', sha256:before, tables, totalRows, tennisRows, activeDuplicateGroups, readOnly:true, historicalTennisRowsChanged:false, stakeDiagnostics }, null, 2));
