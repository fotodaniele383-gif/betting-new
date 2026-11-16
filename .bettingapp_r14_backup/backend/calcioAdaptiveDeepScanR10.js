'use strict';
// R10: perizia descrittiva sui dati realmente osservati. Non assegna stake e
// non modifica la probabilita production o i gate R9.
const VERSION='BETTINGAPP_R10_ADAPTIVE_DEEPSCAN_V1';
const finite=(x)=>x!==null&&x!==undefined&&x!==''&&!['boolean','object'].includes(typeof x)&&Number.isFinite(Number(x));
const round=(n)=>Math.round(n*10)/10;
const esc=(s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LINKS=Object.freeze({
 MODEL_PROBABILITY:[],
 XG_REAL:['https://understat.com/','https://www.fotmob.com/leagues/55/stats/season/36072/teams/expected_goals_team/serie','https://xg.football/competitions/italy-serie-a/xg'],
 MARKET_REFERENCE:['https://www.oddsportal.com/','https://www.the-odds-api.com/'],
 HISTORY:['https://www.football-data.co.uk/'],
 NEWS_HOME:['https://news.google.com/','https://www.google.com/search?q=football+club+official+news'],
 NEWS_AWAY:['https://news.google.com/','https://www.google.com/search?q=football+club+official+news'],
 LINEUPS:['https://www.fotmob.com/','https://www.legaseriea.it/'],
 CLUB_ELO:['https://clubelo.com/'],
 DS_GATE_FORWARD:[]
});
const RULES=Object.freeze({MODEL_PROBABILITY:'probabilita del modello originale non calcolabile: verificare input interni e modello calibrato; NON inventare P(win) usando IA',XG_REAL:'xG/xGA per entrambe le squadre, campione, stagione, modello del provider, URL e data del dato',MARKET_REFERENCE:'quote dei lati opposti del medesimo mercato, bookmaker, timestamp e condizioni di esecuzione',HISTORY:'risultati e statistiche casa/trasferta con cutoff antecedente al calcio d’inizio',NEWS_HOME:'infortuni, squalifiche e comunicati ufficiali della squadra di casa',NEWS_AWAY:'infortuni, squalifiche e comunicati ufficiali della squadra ospite',LINEUPS:'formazioni probabili e confermate, distinguendole chiaramente',CLUB_ELO:'rating di forza e data dello snapshot della squadra',DS_GATE_FORWARD:'storico interno immutabile DeepScan × Gate della stessa versione/coorte (non ricostruibile con fonti esterne)'});
function assess({home,away,league,prediction,odd,probability,edgePp,sourceAudit={},pillars=[],professionalAudit={},marketReferenceCertified=false,temporalAnalysis={},historicalCombinationEvidence={}}={}){
 const rows=Array.isArray(sourceAudit.sources)?sourceAudit.sources:[];
 const byId=id=>rows.find(r=>r.id===id)||{status:'MISSING'};
 const status=id=>String(byId(id).status||'MISSING').toUpperCase();
 const ratio=id=>({AVAILABLE:1,VERIFIED:1,PARTIAL:.5,FALLBACK:.25,MISSING:0,ERROR:0}[status(id)]??0);
 const refOk=marketReferenceCertified===true && status('MARKET_ODDS')==='AVAILABLE';
 const xgOk=status('UNDERSTAT_XG')==='AVAILABLE' && byId('UNDERSTAT_XG').authority==='MODEL_INPUT';
 const newsHome=status('HOME_NEWS')==='VERIFIED'||status('HOME_NEWS')==='AVAILABLE';
 const newsAway=status('AWAY_NEWS')==='VERIFIED'||status('AWAY_NEWS')==='AVAILABLE';
 const lineupOk=professionalAudit?.lineupNews?.lineupConfirmed===true || sourceAudit.sourceAuthority?.officialLineupConfirmed===true;
 const hist=ratio('FOOTBALL_DATA');
 const weight=[.28,.20,.20,.12,.12,.08];
 const availability=[Math.max(refOk?1:ratio('MARKET_ODDS')*.5,0),Math.max(xgOk?1:hist*.5,0), (ratio('HOME_NEWS')+ratio('AWAY_NEWS'))/2, league?1:0, finite(probability)&&finite(odd)?1:0, rows.length?1:0];
 let numerator=0,denominator=0,coverage=0;
 for(let i=0;i<6;i++){
  const r=Number(pillars[i]?.risk);
  const a=availability[i];
  coverage+=weight[i]*a;
  if(a>0&&Number.isFinite(r)){
   // Le componenti completamente assenti non entrano nel denominatore;
   // le osservazioni parziali hanno peso proporzionale alla copertura.
   const w=weight[i]*a;numerator+=r*w;denominator+=w;
  }
 }
 const score=denominator?round(Math.max(0,Math.min(100,100-numerator/denominator))):null;
 const coveragePct=round(coverage*100);
 const missing=[];
 if(!finite(probability))missing.push('MODEL_PROBABILITY');
 if(!xgOk)missing.push('XG_REAL');
 if(!refOk)missing.push('MARKET_REFERENCE');
 if(hist===0)missing.push('HISTORY');
 if(!newsHome)missing.push('NEWS_HOME');
 if(!newsAway)missing.push('NEWS_AWAY');
 if(!lineupOk)missing.push('LINEUPS');
 if(status('CLUB_ELO')!=='AVAILABLE')missing.push('CLUB_ELO');
 const dsSample=historicalCombinationEvidence?.exactSample ?? historicalCombinationEvidence?.sample ?? historicalCombinationEvidence?.n ?? historicalCombinationEvidence?.resolved;
 if(!finite(dsSample)||Number(dsSample)<30)missing.push('DS_GATE_FORWARD');
 let light='YELLOW',label='WATCHLIST · DATI PARZIALI';
 if(!finite(probability)||!finite(odd)||Number(odd)<=1|| (finite(edgePp)&&Number(edgePp)<-2.5) || (score!==null&&score<40)) {light='RED';label='SCARTA / ALTO RISCHIO';}
 else if(coveragePct>=80&&refOk&&score!==null&&score>=75&&finite(edgePp)&&Number(edgePp)>=3){light='GREEN';label='VIA LIBERA ANALITICA · NON STAKE';}
 else if(coveragePct<40){label='WATCHLIST · COPERTURA MOLTO BASSA';}
 const italy=/(?:SERIE\s*A|ITALY|ITALIA)/i.test(String(league||''));
 const data=missing.map(id=>({id,question:RULES[id],urls:id==='XG_REAL'&&!italy
     ? ['https://understat.com/','https://www.fotmob.com/','https://xg.football/']
     :LINKS[id]}));
 const prompt=buildPrompt({home,away,league,prediction,odd,probability,light,label,score,coveragePct,missingData:data});
 return {version:VERSION,kind:'ADVISORY_ONLY_NO_STAKE_AUTHORITY',light,label,observedConfidenceScore:score,coveragePct,missingData:data,missingFields:missing,sourceStatuses:Object.fromEntries(rows.map(x=>[x.id,x.status])),prompt,modelReliabilityUnchanged:true,paperStakeAuthority:false,newsDeferred:temporalAnalysis?.shouldDeferNews===true,warning:'Il punteggio osservato esclude dati totalmente mancanti, ma NON sostituisce affidabilita calibrata, EV netto o gate R9.'};
}
function buildPrompt({home,away,league,prediction,odd,probability,light,label,score,coveragePct,missingData=[]}={}){
 const head=[
 'SECONDO APPROFONDIMENTO IA - BETTINGAPP R10',
 `Match: ${home||'N/D'} - ${away||'N/D'}`,
 `Lega: ${league||'N/D'} | Mercato: ${prediction||'N/D'} | Quota: ${finite(odd)?odd:'N/D'}`,
 `Probabilita del modello originale: ${finite(probability)?probability+'%':'N/D'}`,
 `Semaforo provvisorio: ${label||light||'GIALLO'} | Score osservato: ${score??'N/D'}/100 | Copertura: ${coveragePct??0}%`,
 'Non ripetere le informazioni già verificate. Ricerca SOLO i dati mancanti qui sotto.'
 ];
 const body=missingData.length?missingData.map((d,i)=>`${i+1}. ${d.question}\n   Fonti suggerite: ${d.urls.length?d.urls.join(' ; '):'Solo archivio interno forward BettingApp, non siti esterni'}`).join('\n'):'Non sono stati rilevati campi totalmente mancanti. Verifica coerenza e freschezza delle fonti.';
 const end='Per ogni dato restituisci: campo, squadra, valore, unita, fonte, URL esatto, stagione, observed_at, fetched_at, campione, stato (VERIFICATO/PROBABILE/PROXY/ASSENTE/CONFLITTO). Non inventare valori, non usare dati posteriori al match per backtest. Non presentare una fonte suggerita come fonte effettivamente consultata. Nessuna modifica automatica al DB, probabilita, semaforo operativo o stake: gli esiti vanno verificati e importati separatamente.';
 return head.join('\n')+'\n\nDATI DA RECUPERARE\n'+body+'\n\nREGOLE\n'+end;
}
function renderHtml(a){
 const color={RED:'#ef4444',YELLOW:'#f59e0b',GREEN:'#22c55e'}[a.light]||'#f59e0b';
 return `<section data-r10-adaptive="1" style="padding:14px;margin:10px 18px;border:1px solid ${color};border-radius:9px;background:#111827;color:#e2e8f0;font-family:Arial,sans-serif"><strong style="color:${color}">● ${esc(a.label)}</strong><div style="margin-top:8px;font-size:13px">Affidabilita osservata: <strong>${a.observedConfidenceScore===null?'N/D':a.observedConfidenceScore+'/100'}</strong> · Copertura: <strong>${a.coveragePct}%</strong> · Stake: <strong>decide esclusivamente R9</strong></div><p style="font-size:12px;color:#cbd5e1">Variabili mancanti: ${esc(a.missingFields.join(', ')||'nessuna')}.</p><p style="font-size:12px;color:#94a3b8">Il punteggio osservato esclude variabili interamente mancanti. Il modello probabilistico e i veti non sono alterati. Copia il Prompt + fonti per il secondo approfondimento IA.</p></section>`;
}
module.exports={VERSION,LINKS,RULES,assess,buildPrompt,renderHtml};
