/* BETTINGAPP_CALCIO_EV_SCOPE_UI_R1_20261105 */
/* BETTINGAPP_MATCH_PROMPT_V3_20261105
   UI-only, no API requests, no betting orders, no DB writes, no scheduler changes.
   Reads only the visible row in #analysisTable and user-entered supplementary data.
*/
(function () {
  'use strict';
  const VERSION='BETTINGAPP_MATCH_PROMPT_V3_20261105';
  const STORAGE_PREFIX='bettingapp:quantMatchPromptV3:';
  const SOURCES=[
    ['Formazioni/ballottaggi (Gazzetta)','https://www.gazzetta.it/calcio/prob_form/'],
    ['Probabili formazioni (PianetaFanta)','https://www.pianetafanta.it/probabili-formazioni-fantacalcio'],
    ['Probabili formazioni (Fantacalcio Online)','https://www.fantacalcio-online.com/it/home'],
    ['Probabilita titolarita (SOS Fanta)','https://www.sosfanta.com/lista-formazioni/probabili-formazioni-serie-a/'],
    ['Formazioni confermate (BeSoccer)','https://lineups.besoccer.com/it'],
    ['Formazioni (Sky Sport)','https://sport.sky.it/calcio/serie-a/probabili-formazioni'],
    ['Pagelle storiche (Sky Sport)','https://sport.sky.it/calcio/serie-a/pagelle'],
    ['StatsBomb Open Data','https://github.com/hudl/open-data'],
    ['OpenFootball risultati','https://github.com/openfootball/football.json'],
    ['Football-Data storico e quote','https://football-data.co.uk/italym.php'],
    ['Understat xG manuale','https://understat.com/']
  ];
  const layout=[
    ['0','Data'],['1','Partita'],['2','DeepScan e stato'],['3','Qualita/Gate'],
    ['4','Competizione'],['5','Pronostico'],['6','Quota e riferimento'],
    ['7','Probabilita'],['8','Campione storico DS x Gate'],['9','Edge/EV'],
    ['10','Affidabilita AI'],['11','Qualita evidenze'],['12','Indice predizione'],
    ['13','Stake'],['14','Profitto potenziale']
  ];
  function node(tag, props, children) {
    const e=document.createElement(tag);props=props||{};
    Object.keys(props).forEach(k => { if(k==='style')Object.assign(e.style,props[k]);else if(k==='className')e.className=props[k];else if(k==='text')e.textContent=props[k];else if(k==='type')e.type=props[k];else e.setAttribute(k,props[k]); });
    (children||[]).forEach(ch => e.appendChild(typeof ch==='string'?document.createTextNode(ch):ch));return e;
  }
  function plain(t){return String(t||'').replace(/\s+/g,' ').trim().slice(0,850);}
  function collect(button, match, league, prediction, odd, odd1, oddX, odd2){
    const tr=button&&button.closest?button.closest('tr'):null;
    const tds=tr?Array.from(tr.children).filter(x=>x.tagName==='TD'):[];
    const fields={};layout.forEach(([i,label])=>{fields[label]=tds[Number(i)]?plain(tds[Number(i)].innerText||tds[Number(i)].textContent):'NON DISPONIBILE';});
    // Never infer missing bookmaker markets from a displayed selection's quote.
    return {match:plain(match||fields.Partita),league:plain(league||fields.Competizione),prediction:plain(prediction||fields.Pronostico),odd:plain(odd),odds1:plain(odd1),oddsX:plain(oddX),odds2:plain(odd2),fields};
  }
  function intro(d){return [
   'MATCH: '+(d.match||'NON DISPONIBILE'),
   'COMPETIZIONE: '+(d.league||'NON DISPONIBILE'),
   'PRONOSTICO PRESENTE: '+(d.prediction||'NON DISPONIBILE'),
   'QUOTA PRESENTE: '+(d.odd||'NON DISPONIBILE'),
   'QUOTE 1/X/2 (solo se presenti): '+[d.odds1,d.oddsX,d.odds2].join(' / '),
   'DATI EVIDENZA VISIBILI IN BETTINGAPP (testo UI, NON prova indipendente):',
   ...Object.entries(d.fields).map(([k,v])=>' - '+k+': '+v)
  ].join('\n');}
  const missingSections=[
   '1) MODELLO DIXON-COLES: p(1/X/2), quote fair, p(Over/Under2.5), BTTS, lambdaH/lambdaA, totale, ratio, rho, red flag; indicare precisione e versione.',
   '2) CALIBRAZIONE/INCERTEZZA: UI (valore e scala), shrinkage alpha, p calibrate, CI/probabilita prudente, campione fuori campione e minimo EV valido.',
   '3) STRUTTURA BVS: BVS pura/semi/non-BVS, linearita, delta e strategia; se BVS non definito, chiedere definizione prima di usarlo.',
   '4) QUOTE: bookmaker e timestamp per 1/X/2, Under/Over2.5 e BTTS; Exchange bid/ask, liquidita, commissione; evitare quote non attuali.',
   '5) FORMAZIONI: titolari UFFICIALI o PROBABILI (non confondere), moduli, ballottaggi, infortuni, arbitro e medie, meteo e campo con URL e ora.',
   '6) SQUADRE ultime 4-5 gare: tiri, tiri in porta, xG/xGA, gol, falli, cartellini; casa/trasferta e campione.',
   '7) GIOCATORI: portieri parate/90 e minuti, tiratori tiri e tiri in porta/90, xG/90, disponibilita, numero partite.',
   '8) MERCATI SPECIALI QUOTATI: handicap asiatico (linea, lato, quota), multigol, parate, cartellini, player props; bookmaker e timestamp.',
   '9) PROVENIENZA: url esatto, data e ora osservazione, tipo PREMATCH/POSTMATCH, periodo, stagione, attendibilita e licenza/possibilita d uso.'
  ];
  function stage1(d){return [
   'FASE 1 DI 2 — ANALISI CALCIO SENIOR QUANT: RICHIEDI SOLO DATI MANCANTI',
   'Non inventare statistiche, esiti, quote o formazioni. NON dare subito picks. Le fonti utente sono dichiarazioni finche non sono verificabili.',
   intro(d),'', 'VERIFICHE RICHIESTE:',...missingSections.map(s=>'- '+s),
   '', 'Confronta i dati esistenti con quelli mancanti; fai fino a 5 domande mirate per volta, priorita a 1) quote attuali dei mercati vicini a 2, 2) formazioni ufficiali, 3) xG recente e 4) intervalli delle probabilita.',
   'Fornisci una scheda dei campi disponibili/mancanti, evidenzia incongruenze (partita/data/campionato, quote, p e EV, fonti e leakage).',
   'Verifica specificamente: quote best-of-bookmaker vs TERNA 1X2 dello stesso bookmaker/istante; formazione PROBABILE vs UFFICIALE e suoi URL; indicare N/D se xG/DC o CI non disponibili.',
   'Non confondere percentuale di affidabilita o indice predizione con p(win), ne rating o voto con xG.',
   'L acquisizione di informazioni non autorizza stake o modifica del DB.'
  ].join('\n');}
  function stage2(d,supp,markets){return [
   'FASE 2 DI 2 — VALUTAZIONE CONSERVATIVA DI DUE SINGOLE VICINE A QUOTA 2',
   'Ruoli: quantitative analyst, market microstructure, DeepScan e risk manager. Non effettuare ordini e non modificare lo storico.',
   intro(d), '', 'EVIDENZE INSERITE MANUALMENTE DAL UTENTE (non verificate automaticamente):',supp.trim()||'NESSUNA',
   '', 'MERCATI SPECIALI, QUOTE E FONTI INSERITI DALL UTENTE:',markets.trim()||'NESSUNA',
   '', 'ISTRUZIONI OBBLIGATORIE:',
   '1. Controlla calendario/stagione, stato PREMATCH e timestamp quote. Non utilizzare dati POSTMATCH per una decisione PREMATCH.',
   '1a. Non elevare mai una formazione manuale o probabile a UFFICIALE senza comunicazione di club/lega e orario. Segnala contraddizioni su portieri/indisponibili e imponi riesame (GIALLO) o veto se decisive e non verificabili.',
   '2. Elenca probabilita Dixon-Coles, p calibrate, fair odds e intervallo d incertezza. Mostra separatamente xG, Elo e DeepScan; non raddoppiare assenze gia incorporate nel modello.',
   '3. Applica DeepScan VERDE/GIALLO/ROSSO: un veto ROSSO impedisce il BET anche con EV teorico positivo. Correggi p solo con dati nuovi documentati.',
   '4. Per ogni mercato esegui quota effettiva, p implicita e, se appropriato, no-vig; p modello, p prudente inferiore, edge in pp vs mercato no-vig, EV=100*(p*quota-1), EV prudente=100*(p_inf*quota-1).',
   '4a. EV positivo per un singolo mercato (es. 2 @9.40) non e trasferibile a GG, Under/Over o props. Per ogni mercato separa p modello, p inferiore, benchmark e payout; se mancano scrivi NON STIMABILE.',
   '4b. Calcola no-vig soltanto con esiti esaustivi dello stesso bookmaker, stesso mercato e timestamp coerente. Terne 1X2 best-price da diversi bookmaker o con somma implicite inferiore a 100%: segnala UNDERROUND/CROSS-BOOK, verifica disponibilita e NON certificare p di mercato.',
   '5. Gli handicap asiatici .25/.75, rimborsi/push, multigol e mercati combinati richiedono il payout specifico per ogni punteggio, non la formula binaria semplificata.',
   '6. Se manca una probabilita calibrata per parate, cartellini o player props, lascia il mercato SENZA STIMA anziche inventare p.',
   '7. Compara preferibilmente mercati con quote REALI tra 1.70 e 2.30; la vicinanza a 2 non implica rischio minore. Dai priorita alla p prudente, all EV prudente > 0 e alla copertura delle fonti. Segnala correlazioni tra le due scelte.',
   '8. Restituisci FINO A DUE SINGOLE, non una multipla, solo se sostenute da prova e da EV prudente positivo. Se non ce ne sono due, restituisci una o NO BET; non forzare quote o picks.',
   '9. Per ciascuna: mercato e linea esatta, quota e bookmaker e orario, p stimata e intervallo, p perdita, EV e EV prudente, motivo, fattori di rischio, tipo dati e fonte. Indica se la quota e scaduta.',
   '10. Stake operativo = 0 se il gate SAFE13 / portfolio non e autorizzato. Puoi descrivere soltanto un valore teorico, senza suggerire aggiramenti del gate HTTP 423.',
   '11. Non promettere profitto, vincita o un rischio di perdita minimo garantito; distingui lo scenario a quota circa 2 dalle probabilita effettive.',
   '', 'OUTPUT RICHIESTO: Tabella valori dei mercati; candidate ranking 1-2; criticita; dati ancora richiesti; verdetto finale (1-2 selezioni oppure NO BET).'
  ].join('\n');}
  function likelyTennis(league){return /\b(atp|wta|itf|challenger|grand slam|masters 1000|tennis)\b/i.test(league||'');}
  async function copyText(txt){
    if(navigator.clipboard&&navigator.clipboard.writeText)try{await navigator.clipboard.writeText(txt);return true;}catch(_){}
    const ta=node('textarea',{style:{position:'fixed',left:'-10000px',top:'0'}});ta.value=txt;document.body.appendChild(ta);ta.select();const ok=document.execCommand&&document.execCommand('copy');ta.remove();return !!ok;
  }
  function openModal(d){
    const existing=document.getElementById('quant-v3-overlay');if(existing)existing.remove();
    const key=STORAGE_PREFIX+(d.league+'|'+d.match).toLowerCase().replace(/[^a-z0-9|]/g,'_').slice(0,130);
    const overlay=node('div',{id:'quant-v3-overlay',style:{position:'fixed',inset:'0',background:'rgba(5,10,20,.90)',zIndex:'999999',overflowY:'auto',padding:'16px',color:'#edf2fa',font:'14px/1.45 system-ui,sans-serif'}});
    const panel=node('div',{style:{maxWidth:'970px',margin:'18px auto',padding:'20px',border:'1px solid #334155',borderRadius:'14px',background:'#0f172a',boxShadow:'0 10px 45px rgba(0,0,0,.45)'}});
    const title=node('h2',{text:'🧠 DeepScan + Prompt AI · '+d.match,style:{margin:'0 0 10px',fontSize:'19px'}});
    const note=node('p',{text:'Modalita informativa: non invia dati alla rete, non cambia stake o quote e non aggira SAFE13_MANUAL_ONLY.',style:{color:'#cbd5e1'}});
    const snapshot=node('pre',{text:intro(d),style:{background:'#020617',padding:'12px',whiteSpace:'pre-wrap',fontSize:'11px',maxHeight:'220px',overflowY:'auto',border:'1px solid #334155'}});
    const sources=node('details',{},[node('summary',{text:'🔎 Apri fonti suggerite (lettura manuale, nessuno scraping)'} )]);
    const links=node('div',{style:{display:'flex',flexWrap:'wrap',gap:'9px',margin:'10px 0'}});
    SOURCES.forEach(([label,url])=>links.appendChild(node('a',{href:url,target:'_blank',rel:'noopener noreferrer',text:label,style:{color:'#93c5fd',padding:'5px 7px',border:'1px solid #334155',borderRadius:'6px'}})));
    sources.appendChild(links);
    const help=node('p',{text:'Inserisci dati e URL verificabili. Ogni quota speciale deve avere mercato, LINEA, bookmaker, timestamp. Non usare pagelle successive al match per decidere pre-match.',style:{color:'#fbbf24',fontSize:'12px'}});
    const evidence=node('textarea',{placeholder:'Es. Formazioni probabili [fonte URL; aggiornato AAAA-MM-GG HH:mm] ...\nxG casa/trasferta ultime 5 ...\nArbitro: ...',style:{width:'100%',minHeight:'125px',padding:'11px',background:'#020617',color:'white',border:'1px solid #475569',borderRadius:'6px',boxSizing:'border-box'}});
    const markets=node('textarea',{placeholder:'Ogni riga: Mercato preciso | Quota | Bookmaker | Timestamp | Fonte URL\nEs. Over 4.5 cartellini | 1.98 | bookmaker XY | 2026-11-05 15:00 | URL...',style:{width:'100%',minHeight:'95px',padding:'11px',background:'#020617',color:'white',border:'1px solid #475569',borderRadius:'6px',boxSizing:'border-box'}});
    try{const old=JSON.parse(localStorage.getItem(key)||'{}');evidence.value=String(old.evidence||'');markets.value=String(old.markets||'');}catch(_){}
    const status=node('p',{text:'Pronto. Copia il prompt in ChatGPT o nel tuo assistente AI.',style:{color:'#a7f3d0'}});
    const bar=node('div',{style:{display:'flex',flexWrap:'wrap',gap:'8px',margin:'12px 0'}});
    function btn(label,fn){const b=node('button',{type:'button',text:label,style:{cursor:'pointer',background:'#1d4ed8',color:'#fff',padding:'9px 13px',border:'0',borderRadius:'8px',fontWeight:'600'}});b.addEventListener('click',fn);return b;}
    bar.appendChild(btn('1 · Copia richiesta dati mancanti',async()=>status.textContent=(await copyText(stage1(d)))?'FASE 1 copiata. Incolla nel tuo assistente AI.':'Impossibile copiare: usa selezione manuale.'));
    bar.appendChild(btn('2 · Copia analisi e due scelte',async()=>status.textContent=(await copyText(stage2(d,evidence.value,markets.value)))?'FASE 2 copiata. Le scelte saranno valide solo con dati affidabili.':'Impossibile copiare: usa selezione manuale.'));
    bar.appendChild(btn('💾 Salva appunti locali',()=>{try{localStorage.setItem(key,JSON.stringify({evidence:evidence.value.slice(0,30000),markets:markets.value.slice(0,30000)}));status.textContent='Appunti salvati solo nel browser (localStorage).';}catch(_){status.textContent='Impossibile salvare appunti nel browser.';}}));
    bar.appendChild(btn('Chiudi',()=>overlay.remove()));
    panel.append(title,note,snapshot,sources,help,node('h3',{text:'Dati aggiuntivi: Understat, Gazzetta, giocatori, arbitro, forma'}),evidence,node('h3',{text:'Quote reali dei mercati speciali (anche asian, multigol, parate, cartellini, tiri)'}),markets,bar,status);
    overlay.appendChild(panel);document.body.appendChild(overlay);overlay.addEventListener('click',ev=>{if(ev.target===overlay)overlay.remove();});
    const closeKey=ev=>{if(ev.key==='Escape'){overlay.remove();document.removeEventListener('keydown',closeKey);}};document.addEventListener('keydown',closeKey);
  }
  function install(){
    if(window.__quantMatchPromptV3Installed)return;
    const original=window.copyAIPrompt;if(typeof original!=='function')return;
    window.copyAIPrompt=function(button,match,league,prediction,odd,odd1,oddX,odd2){
      if(likelyTennis(league)){return original.apply(this,arguments);}
      return openModal(collect(button,match,league,prediction,odd,odd1,oddX,odd2));
    };
    window.__quantMatchPromptV3Installed=true;
    const transform=()=>document.querySelectorAll('#analysisTable tbody button[onclick*="copyAIPrompt"]').forEach(b=>{if(b.dataset.quantV3)return;b.dataset.quantV3='1';b.textContent='🧠 Prompt + fonti';b.title='Richiedi dati mancanti, integra Understat e valuta fino a 2 singole a quota vicina a 2';});
    transform();const tb=document.getElementById('valueBetsTable');if(tb)new MutationObserver(transform).observe(tb,{childList:true});
    console.info(VERSION+' UI_ONLY; NO_DB_WRITE; NO_AUTO_STAKE');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
