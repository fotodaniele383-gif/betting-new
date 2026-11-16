'use strict';

const crypto = require('crypto');
const VERSION = 'TENNIS_EXTERNAL_RECEIPT_LINK_V1_PATCH39';
function sha(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');}
function createSchema(db){db.exec(`
CREATE TABLE IF NOT EXISTS tennis_external_receipt_links(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 link_id TEXT NOT NULL UNIQUE,
 bet_id INTEGER NOT NULL,
 receipt_id TEXT NOT NULL,
 linked_at TEXT NOT NULL,
 version TEXT NOT NULL,
 event_key TEXT,
 receipt_hash TEXT,
 payload_json TEXT NOT NULL,
 link_hash TEXT NOT NULL UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tennis_external_receipt_link_unique ON tennis_external_receipt_links(bet_id,receipt_id);
CREATE TRIGGER IF NOT EXISTS trg_tennis_external_receipt_links_no_update BEFORE UPDATE ON tennis_external_receipt_links BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_RECEIPT_LINK_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_tennis_external_receipt_links_no_delete BEFORE DELETE ON tennis_external_receipt_links BEGIN SELECT RAISE(ABORT,'TENNIS_EXTERNAL_RECEIPT_LINK_APPEND_ONLY'); END;
`);}
function column(db,table,name){return db.prepare(`PRAGMA table_info(${table})`).all().some(r=>String(r.name||r[1])===name);}
function link(db,row,receipt){
  if(!db||!row?.id||!receipt?.receipt_id)return null;
  createSchema(db);
  if(Number(receipt.bet_id||0)!==Number(row.id))throw new Error('PATCH39_RECEIPT_BET_ID_MISMATCH');
  let existing=db.prepare('SELECT * FROM tennis_external_receipt_links WHERE bet_id=? AND receipt_id=?').get(Number(row.id),receipt.receipt_id);
  if(!existing){
    const linkedAt=receipt.generated_at||new Date().toISOString();
    const canonical={version:VERSION,betId:Number(row.id),receiptId:receipt.receipt_id,eventKey:receipt.event_key||null,receiptHash:receipt.receipt_hash||null};
    const linkHash=sha(canonical),linkId=`TERL39_${Number(row.id)}_${linkHash.slice(0,16)}`;
    const payload={...canonical,linkedAt};
    db.prepare('INSERT INTO tennis_external_receipt_links(link_id,bet_id,receipt_id,linked_at,version,event_key,receipt_hash,payload_json,link_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(linkId,Number(row.id),receipt.receipt_id,linkedAt,VERSION,payload.eventKey,payload.receiptHash,JSON.stringify(payload),linkHash);
    existing=db.prepare('SELECT * FROM tennis_external_receipt_links WHERE bet_id=? AND receipt_id=?').get(Number(row.id),receipt.receipt_id);
  }
  if(column(db,'ai_forward_test','tennis_external_intelligence_receipt_id'))db.prepare("UPDATE ai_forward_test SET tennis_external_intelligence_receipt_id=? WHERE id=? AND COALESCE(tennis_external_intelligence_receipt_id,'')<>?").run(receipt.receipt_id,Number(row.id),receipt.receipt_id);
  return existing;
}
function repairMissingLinks(db){createSchema(db);const rows=db.prepare(`SELECT r.*,a.tennis_external_intelligence_receipt_id FROM tennis_external_intelligence_receipts r JOIN ai_forward_test a ON a.id=r.bet_id WHERE COALESCE(a.tennis_external_intelligence_receipt_id,'')='' ORDER BY r.id`).all();let linked=0;for(const receipt of rows){const row=db.prepare('SELECT * FROM ai_forward_test WHERE id=?').get(receipt.bet_id);if(row&&link(db,row,receipt))linked++;}return{candidates:rows.length,linked};}
function health(db){createSchema(db);const receiptRows=Number(db.prepare("SELECT COUNT(*) n FROM tennis_external_intelligence_receipts").get().n);const linkedRows=Number(db.prepare("SELECT COUNT(*) n FROM tennis_external_receipt_links").get().n);const missing=Number(db.prepare(`SELECT COUNT(*) n FROM tennis_external_intelligence_receipts r JOIN ai_forward_test a ON a.id=r.bet_id WHERE COALESCE(a.tennis_external_intelligence_receipt_id,'')=''`).get().n);return{version:VERSION,receiptRows,linkedRows,missingRowLinks:missing,status:missing===0?'COMPLETE':'INCOMPLETE',probabilityAuthority:false,stakeAuthority:false};}
module.exports={VERSION,createSchema,link,repairMissingLinks,health};
