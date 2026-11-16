'use strict';
// Avvia la sola copia manuale autonoma; apre il browser solo a health verificato.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),http=require('node:http');
const {DatabaseSync}=require('node:sqlite');
const ROOT=__dirname,PORT=3188,URL='http://127.0.0.1:'+PORT;
function sha(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}
function assert(v,msg){if(!v)throw Error(msg)}
function status(){
 const statePath=path.join(ROOT,'BETTINGAPP_STANDALONE_STATE.json');assert(fs.existsSync(statePath),'STATE_INSTALLAZIONE_NON_TROVATO');
 const state=JSON.parse(fs.readFileSync(statePath,'utf8'));assert(state.version==='BETTINGAPP_MANUALE_PULITO_R1_20261105'&&state.mode==='SAFE13_MANUAL_PAPER_ONLY','STATE_NON_COMPATIBILE');
 const server=path.join(ROOT,'backend','server.js'),tennis=path.join(ROOT,'backend','server.tennis.js');
 assert(fs.existsSync(server)&&fs.existsSync(tennis),'SERVER_NON_TROVATO');
 const verifiedCore=require('./START_BETTING_CORE_CHAIN_R3.cjs').assertTrustedCore({root:ROOT,state});
 console.log('CORE_INTEGRITY=PASS '+verifiedCore.mode);
 const source=fs.readFileSync(server,'utf8');assert(source.includes('SAFE13_MANUAL_ONLY')&&source.includes('SAFE13_MANUAL_PAPER_LAUNCHER_REQUIRED'),'PROTEZIONE_MANUALE_ASSENTE');
 const deps=path.join(ROOT,'node_modules');assert(fs.existsSync(deps)&&!fs.lstatSync(deps).isSymbolicLink(),'NODE_MODULES_NON_AUTONOMI');
 const BetterSqlite=require(path.join(deps,'better-sqlite3'));const mdb=new BetterSqlite(':memory:');try{assert(mdb.prepare('SELECT 1 AS n').get().n===1,'BETTER_SQLITE3_TEST_FAIL')}finally{mdb.close()}
 const dbfile=path.join(ROOT,'backend','database_betting.db');const db=new DatabaseSync(dbfile,{readOnly:true});let info;
 try{db.exec('PRAGMA query_only=ON');assert(db.prepare('PRAGMA quick_check').get().quick_check==='ok','DB_QUICK_CHECK_FAIL');info=db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(id),0) AS m FROM ai_forward_test').get()}finally{db.close()}
 assert(Number(info.n)>=state.src_db_rows&&Number(info.m)>=state.src_db_max_id,'DB_RECORDS_INFERIORI_ALLA_SORGENTE');
 const env={...process.env,SAFE13_MANUAL_PAPER:'1',BETTING_DB_PATH:dbfile,PORT:String(PORT),BETTINGAPP_BIND_HOST:'127.0.0.1',BETTINGAPP_REMOTE_ACCESS_ENABLED:'0',BETTINGAPP_ALLOW_NON_LOOPBACK_BIND:'0',CLV_AUTO_TRACKER_ENABLED:'0',CALCIO_FOOTBALL_DATA_AUTO_REFRESH:'0',NODE_OPTIONS:''};
 const sec=require(path.join(ROOT,'backend','productionSecuritySafeReleasePatch57.js')).resolveRuntimeConfig({env});
 assert(sec.ready&&sec.bindHost==='127.0.0.1'&&!sec.remoteAccessEnabled&&Number(sec.port)===PORT,'SECURITY_CONFIG_NON_SICURA');
 return {state,env,dbfile,rows:Number(info.n),maxId:Number(info.m)};
}
function health(timeoutMs=1400){return new Promise((resolve)=>{
 const req=http.get(URL+'/api/health',{timeout:timeoutMs},res=>{let b='';res.on('data',c=>{if(b.length<150000)b+=c});res.on('end',()=>{try{const h=JSON.parse(b);if(res.statusCode===200&&h.success===true&&h.dbPath){resolve({ok:true,dbPath:path.resolve(h.dbPath)})}else resolve({ok:false})}catch{resolve({ok:false})}})});
 req.on('timeout',()=>req.destroy());req.on('error',()=>resolve({ok:false}));
 })}
async function waitReady(expected,seconds=90){for(let i=0;i<seconds;i++){let h=await health();if(h.ok){assert(path.resolve(h.dbPath).toLowerCase()===path.resolve(expected).toLowerCase(),'PORTA_3188_OCCUPATA_DA_ALTRA_COPIA');return true}await new Promise(r=>setTimeout(r,1000))}return false}
function openBrowser(){
 if(process.platform!=='win32'){console.log('APRI_BROWSER='+URL);return}
 // Start-Process usa il gestore URL predefinito della sessione Windows.
 // Si controlla il codice di uscita del comando, non si presume che la UI sia visibile.
 let result;
 try{
  result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Start-Process -FilePath '"+URL+"'"],{cwd:ROOT,windowsHide:true,encoding:'utf8',timeout:12000});
  if(result.status===0){console.log('BROWSER=COMANDO_WINDOWS_ESEGUITO '+URL);return}
  console.warn('BROWSER=POWERSHELL_NON_RIUSCITO status='+String(result.status)+' errore='+String(result.error?.code||'none'));
 }catch(e){console.warn('BROWSER=POWERSHELL_ERRORE '+e.message)}
 try{
  const fallback=cp.spawnSync('cmd.exe',['/d','/c','start "" "'+URL+'"'],{cwd:ROOT,windowsHide:true,encoding:'utf8',timeout:12000});
  if(fallback.status===0)console.log('BROWSER=FALLBACK_CMD_INVIATO '+URL);
  else console.warn('BROWSER=APERTURA_AUTOMATICA_FALLITA; usa APRI_BETTING.bat URL='+URL);
 }catch(e){console.warn('BROWSER=APERTURA_AUTOMATICA_FALLITA '+e.message+'; usa APRI_BETTING.bat')}
}
function refreshCalcio(){if(process.env.BETTINGAPP_REFRESH_STARTUP==='0'){console.log('AGGIORNAMENTO_DATI_AVVIO=DISABILITATO_DA_UTENTE');return}
 try{const ref=require('./AGGIORNA_DATI.cjs');ref.refresh().then(x=>console.log('AGGIORNAMENTO_CALCIO_CSV='+x)).catch(e=>console.warn('AGGIORNAMENTO_CALCIO_CSV=NON_COMPLETATO '+e.message))}
 catch(e){console.warn('AGGIORNAMENTO_CALCIO_CSV=NON_DISPONIBILE '+e.message)}
}
async function main(){
 if(process.env.BETTINGAPP_LOAD_ENV!=='0'&&fs.existsSync(path.join(ROOT,'.env'))){process.loadEnvFile(path.join(ROOT,'.env'));console.log('CONFIGURAZIONE_ENV=CARICATA_SENZA_MOSTRARE_CHIAVI')}
 const {env,dbfile,rows,maxId}=status();
 console.log('PRECHECK_PULITO=PASS ROWS='+rows+' MAX_ID='+maxId+' NODE='+process.version);
 console.log('MODE=REALE_MANUALE_UI ANALYSIS=LEGACY_SAFE13 BIND=127.0.0.1 PORT='+PORT+' SCHEDULER=OFF SETTLEMENT_AUTO=OFF; IMPORTO_REALE=SOLO_UTENTE');
 console.log('CREDENZIALI_QUOTE='+ (env.ODDS_API_KEYS?'PRESENTI':'NON_CONFIGURATE')+' (validita provider non testata)');
 if(process.argv.includes('--check')){console.log('VERIFICA_STANDALONE=PASS');return}
 let existing=await health();if(existing.ok){assert(path.resolve(existing.dbPath).toLowerCase()===path.resolve(dbfile).toLowerCase(),'PORTA_GIA_OCCUPATA_DA_UN_ALTRA_BETTINGAPP');console.log('SERVER_GIA_ATTIVO_SU_QUESTO_DB');openBrowser();return}
 // Evita avvio se porta occupata da processo senza health atteso.
 const net=require('node:net');const reachable=await new Promise(res=>{let s=net.connect(PORT,'127.0.0.1');s.once('connect',()=>{s.destroy();res(true)});s.once('error',()=>res(false));setTimeout(()=>{s.destroy();res(false)},700)});assert(!reachable,'PORTA_OCCUPATA_IMPOSSIBILE_AVVIARE');
 console.log('AVVIO_SERVER_MANUALE='+URL);
 const child=cp.spawn(process.execPath,[path.join(ROOT,'backend','server.js')],{cwd:ROOT,env,stdio:'inherit',windowsHide:false});
 child.on('error',e=>console.error('AVVIO_SERVER_ERRORE='+e.message));
 let exited=false;child.on('exit',(code,signal)=>{exited=true;console.log('SERVER_STOP code='+code+' signal='+signal)});
 let ready=false;try{ready=await waitReady(dbfile,90)}catch(e){console.error('HEALTH_ERRORE='+e.message)}
 if(ready){console.log('HEALTH=PASS '+URL);openBrowser();refreshCalcio()}else{console.error('HEALTH=FAIL; controlla errori server sopra; nessun browser automatico');if(!exited)child.kill();process.exitCode=1}
}
if(require.main===module)main().catch(e=>{console.error('AVVIO_NEGATO='+e.message);process.exitCode=1});
module.exports={status,health,waitReady};
