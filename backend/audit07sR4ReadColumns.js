'use strict';
// Computational readers only. Original report blobs remain in the database.
const OMIT = new Set(['calcio_market_selection_audit','calcio_market_finalization_audit','calcio_deepscan_final_report_json']);
function columns(db) {
 const names=db.prepare('PRAGMA table_info(ai_forward_test)').all().map(r=>r.name).filter(n=>!OMIT.has(n));
 if(!names.length)throw new Error('AUDIT07S_R4_SCHEMA_UNAVAILABLE');
 return names.map(n=>'"'+n.replace(/"/g,'""')+'"').join(',');
}
module.exports={columns};
