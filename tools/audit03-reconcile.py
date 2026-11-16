"""Read-only economic evidence report. Never updates profit, stake, or bankroll."""
import argparse,sqlite3,json,hashlib,datetime,html,math
from pathlib import Path
from decimal import Decimal
VERSION='AUDIT03_RECONCILIATION_V1'
def digest(p):
 if not p.is_file():return None
 h=hashlib.sha256()
 with p.open('rb') as f:
  for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
def stable(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def fingerprint(x):return hashlib.sha256(stable(x).encode()).hexdigest()
def finite(x):return type(x) in (int,float) and math.isfinite(x)
def economic_issue(row):
 status=row['status'];stake=row['stake'];profit=row['profit'];odd=row['odd']
 if not finite(stake) or stake<0 or not finite(profit):return ('INVALID_MONETARY_FIELDS',None)
 if status=='WON' and (not finite(odd) or odd<=1):return ('INVALID_ODDS',None)
 expected=Decimal(str(stake))*(Decimal(str(odd))-1) if status=='WON' else -Decimal(str(stake)) if status=='LOST' else Decimal(0)
 return ('CURRENT_TERMS_DIFFER_FROM_RECORDED_PROFIT' if abs(Decimal(str(profit))-expected)>Decimal('0.011') else None,float(expected))
def inspect(database):
 database=Path(database).resolve()
 files=[database,Path(str(database)+'-wal'),Path(str(database)+'-shm')];before={p.name:digest(p) for p in files}
 conn=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True);conn.row_factory=sqlite3.Row
 try:
  conn.execute('PRAGMA query_only=ON');conn.execute('BEGIN')
  integrity=conn.execute('PRAGMA quick_check').fetchall()
  if [r[0] for r in integrity]!=['ok']:raise ValueError('DATABASE_INTEGRITY_FAILED')
  tables={r[0] for r in conn.execute("select name from sqlite_master where type='table'")}
  columns={r[1] for r in conn.execute('pragma table_info(ai_forward_test)')}
  required=['id','status','stake','profit','odd']
  if not set(required)<=columns:raise ValueError('REQUIRED_ECONOMIC_SCHEMA_MISSING')
  optional=['sport_type','home_team','away_team','paper_result_active','paper_result_conflict','settlement_source','settlement_observed_at','match_date']
  selected=required+[x for x in optional if x in columns]
  rows=[dict(r) for r in conn.execute('select '+','.join(selected)+" from ai_forward_test where status in ('WON','LOST','PUSH','VOID') order by id")]
  anomalies=[]
  specs=[('tennis_prediction_snapshots',['snapshot_id','snapshot_sequence','snapshot_type','snapshot_status','captured_at','stake_final','opening_odd','snapshot_hash','previous_snapshot_hash']),('tennis_stake_execution_contracts_patch46',['snapshot_id','decided_at','final_executable_stake','contract_hash']),('tennis_settlement_truth_repairs',['repair_id','applied_at','before_hash','after_hash','before_json','after_json']),('prediction_audit_trail',['id','event_type','event_ts','event_hash','previous_hash','snapshot_json'])]
  for row in rows:
   issue,expected=economic_issue(row)
   if not issue:continue
   evidence={};candidate_matches=[]
   for table,fields in specs:
    if table not in tables:evidence[table]={'available':False,'records':[]};continue
    records=[dict(x) for x in conn.execute('select '+','.join(fields)+' from '+table+' where bet_id=? order by '+fields[0],(row['id'],))]
    for record in records:
     for fld in ['snapshot_json','before_json','after_json']:
      if fld in record:
       raw=record.pop(fld);record[fld+'_sha256']=hashlib.sha256(str(raw).encode()).hexdigest()
       try:payload=json.loads(raw);record[fld+'_terms']={k:payload.get(k) for k in ['status','stake','odd','profit','bankroll_snapshot']}
       except (ValueError,TypeError,AttributeError):record[fld+'_invalid']=True
    evidence[table]={'available':True,'records':records}
   for snap in evidence.get('tennis_prediction_snapshots',{}).get('records',[]):
    stake=snap.get('stake_final');odd=snap.get('opening_odd')
    if finite(stake) and finite(odd):
     _,guess=economic_issue({'status':row['status'],'stake':stake,'odd':odd,'profit':row['profit']})
     if guess is not None and finite(row['profit']) and abs(guess-row['profit'])<=.011:candidate_matches.append(snap['snapshot_id'])
   anomalies.append({'id':row['id'],'current':row,'currentRowHash':fingerprint(row),'issue':issue,'formulaUsingCurrentTerms':expected,'candidateSnapshotsMatchingProfit':candidate_matches,'assessment':'HISTORICAL_CANDIDATE_REQUIRES_SETTLEMENT_PROOF' if candidate_matches else 'SETTLEMENT_TERMS_PROOF_REQUIRED','reconciled':False,'automaticCorrectionAllowed':False,'evidence':evidence})
  conn.rollback()
 finally:conn.close()
 after={p.name:digest(p) for p in files}
 if before!=after:raise ValueError('DATABASE_FILES_CHANGED_DURING_READ')
 return {'version':VERSION,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'databaseUnchanged':True,'databaseHashes':after,'dataFingerprint':fingerprint({'rows':rows,'anomalies':anomalies}),'resolvedRowsInspected':len(rows),'anomalyCount':len(anomalies),'unresolvedCount':len(anomalies),'economicReconciliationComplete':bool(rows) and not anomalies,'automaticCorrections':0,'proofPolicy':'Snapshot predictions and stake authorizations do not prove settlement terms or actual execution. Stored chain hashes are references, not independently verified signatures. No automatic historical rewrite.','anomalies':anomalies}
def write_report(report,out):
 out=Path(out);out.mkdir(parents=True,exist_ok=True)
 (out/'reconciliation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
 tr=[]
 for a in report['anomalies']:
  row=a['current'];tr.append('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in [a['id'],row.get('sport_type'),row['status'],row['stake'],row['odd'],row['profit'],a['formulaUsingCurrentTerms'],len(a['candidateSnapshotsMatchingProfit']),a['assessment']])+'</tr>')
 page='<!doctype html><html lang="it"><meta charset="utf-8"><title>AUDIT03 — riconciliazione</title><style>body{font:15px Arial;margin:32px;color:#142334}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #bcc7d0;text-align:left}th{background:#eaf0f5}h1{font-size:24px}@media print{body{margin:10px}thead{display:table-header-group}}</style><h1>AUDIT03 — Verifica contabile per ID</h1><p>Database letto senza modifiche. Righe risolte: '+str(report['resolvedRowsInspected'])+'. Incongruenze da riconciliare: <b>'+str(report['unresolvedCount'])+'</b>.</p><p>La formula sui termini correnti è solo un confronto, non il profitto storico corretto. Le corrispondenze con snapshot sono candidati da verificare al settlement. Rettifiche automatiche: 0.</p><table><thead><tr>'+''.join('<th>'+x+'</th>' for x in ['ID','Sport','Stato','Stake','Quota','Profitto registrato','Formula termini correnti','Snapshot compatibili','Esito'])+'</tr></thead><tbody>'+''.join(tr)+'</tbody></table><p>Dettagli, riferimenti e hash nel file reconciliation.json.</p></html>'
 (out/'reconciliation.html').write_text(page,encoding='utf-8')
def main():
 p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('output');p.add_argument('--strict',action='store_true');a=p.parse_args()
 try:
  r=inspect(a.database);write_report(r,a.output);print(json.dumps({k:r[k] for k in ['readOnly','databaseUnchanged','anomalyCount','unresolvedCount','economicReconciliationComplete','automaticCorrections']}));return 3 if a.strict and not r['economicReconciliationComplete'] else 0
 except Exception as e:print('STOP: '+str(e));return 1
if __name__=='__main__':raise SystemExit(main())
