import sys,importlib.util,tempfile,sqlite3,json
from pathlib import Path
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('reconcile',Path(__file__).with_name('audit03-reconcile.py'));r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
cases=[]
def test(name,fn):
 try:fn();cases.append({'id':name,'pass':True})
 except Exception as e:cases.append({'id':name,'pass':False,'error':str(e)})
def fixture(rows,fn):
 with tempfile.TemporaryDirectory() as d:
  p=Path(d)/'data.db';c=sqlite3.connect(p);c.execute('create table ai_forward_test(id integer primary key,status text,stake real,profit real,odd real)');c.executemany('insert into ai_forward_test values(?,?,?,?,?)',rows);c.commit();c.close();return fn(p,Path(d))
def eq(a,b):assert a==b,(a,b)
test('valid_won_lost_void_push',lambda:fixture([(1,'WON',2,2,2),(2,'LOST',2,-2,2),(3,'VOID',2,0,2),(4,'PUSH',2,0,2)],lambda p,d:eq(r.inspect(p)['anomalyCount'],0)))
test('detect_current_mismatch',lambda:fixture([(1,'LOST',2,0,2)],lambda p,d:eq(r.inspect(p)['unresolvedCount'],1)))
test('zero_stake_loss_not_hidden',lambda:fixture([(1,'LOST',0,-3.02,2)],lambda p,d:eq(r.inspect(p)['anomalyCount'],1)))
test('invalid_null_money',lambda:fixture([(1,'WON',None,0,2)],lambda p,d:eq(r.inspect(p)['anomalyCount'],1)))
test('empty_not_certified',lambda:fixture([],lambda p,d:eq(r.inspect(p)['economicReconciliationComplete'],False)))
test('rounding_tolerance',lambda:fixture([(1,'WON',2,1.11,1.555)],lambda p,d:eq(r.inspect(p)['anomalyCount'],0)))
def immutable(p,d):
 before=p.read_bytes();a=r.inspect(p);b=r.inspect(p);eq(a['dataFingerprint'],b['dataFingerprint']);r.write_report(a,d/'report');eq(p.read_bytes(),before);eq(json.loads((d/'report/reconciliation.json').read_text())['automaticCorrections'],0)
test('repeatable_readonly_reports',lambda:fixture([(1,'LOST',2,0,2)],immutable))
def snapshot(p,d):
 c=sqlite3.connect(p);c.execute('create table tennis_prediction_snapshots(snapshot_id text,bet_id integer,snapshot_sequence integer,snapshot_type text,snapshot_status text,captured_at text,stake_final real,opening_odd real,snapshot_hash text,previous_snapshot_hash text)');c.execute("insert into tennis_prediction_snapshots values('S1',1,1,'ORIGINAL','VALID_PREMATCH','2026-01-01',3.02,2,'unverified',null)");c.commit();c.close();a=r.inspect(p)['anomalies'][0];eq(a['candidateSnapshotsMatchingProfit'],['S1']);eq(a['reconciled'],False);eq(a['automaticCorrectionAllowed'],False)
test('snapshot_match_is_not_settlement_proof',lambda:fixture([(1,'LOST',2,-3.02,2)],snapshot))
def nofile():
 with tempfile.TemporaryDirectory() as d:
  p=Path(d)/'missing.db'
  try:r.inspect(p)
  except sqlite3.Error:pass
  else:raise AssertionError('missing DB accepted')
  eq(p.exists(),False)
test('missing_database_not_created',nofile)
report={'pass':all(c['pass'] for c in cases),'passed':sum(c['pass'] for c in cases),'cases':cases};print(json.dumps(report,indent=2));sys.exit(0 if report['pass'] else 1)
