'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbFile = path.join(root, 'backend', 'database_betting.db');
assert(fs.existsSync(dbFile), 'database_betting.db mancante');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before = sha(dbFile);
const db = new DatabaseSync(dbFile, { readOnly: true });
const tables = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;
const columns = db.prepare("PRAGMA table_info(ai_forward_test)").all().map(row => row.name);
const totalRows = columns.length ? db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n : 0;
const tennisRows = columns.includes('sport_type') ? db.prepare("SELECT COUNT(*) n FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='TENNIS'").get().n : null;
let activeDuplicateGroups = null;
if (columns.includes('paper_result_key') && columns.includes('paper_result_active')) {
    activeDuplicateGroups = db.prepare("SELECT COUNT(*) n FROM (SELECT paper_result_key FROM ai_forward_test WHERE paper_result_active=1 AND paper_result_key IS NOT NULL GROUP BY paper_result_key HAVING COUNT(*)>1)").get().n;
    assert.equal(activeDuplicateGroups, 0, 'Revisioni attive duplicate rilevate');
}
db.close();
const after = sha(dbFile);
assert.equal(after, before, 'Il test DB ha modificato il database');
console.log(JSON.stringify({ success: true, sha256: before, tables, totalRows, tennisRows, activeDuplicateGroups, readOnly: true, historicalTennisRowsChanged: false, patch: 'BETTING_PATCH_14_DATA_AUTHORITY_KELLY_GATE' }, null, 2));
