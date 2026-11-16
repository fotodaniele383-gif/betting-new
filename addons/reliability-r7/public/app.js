'use strict';
let snapshot=null,selected=null;
const el=id=>document.getElementById(id);
function val(id){return el(id).value.trim();}
function placeText(node,v){el(node).textContent=v;}
async function jsonFetch(url,opts){const r=await fetch(url,{cache:'no-store',...opts});const b=await r.json();if(!r.ok)throw Error(b.error||'HTTP '+r.status);return b;}
function chosen(){if(!snapshot)return null;const obj=snapshot.cases.find(c=>c.key===el('cases').value);return obj||null;}
function renderCases(){if(!snapshot)return;const filter=val('filter'),query=val('search').toLocaleLowerCase('it');const list=snapshot.cases.filter(x=>(filter==='ALL'||x.kind===filter)&&(x.key+' '+(x.match||'')).toLocaleLowerCase('it').includes(query));
 const select=el('cases');select.replaceChildren();for(const c of list){const o=document.createElement('option');o.value=c.key;o.textContent=c.key+' · '+(c.match||'contratto')+' · '+c.review.status;select.appendChild(o);}
 if(selected&&list.some(c=>c.key===selected.key))select.value=selected.key;else selected=null;drawSelected();}
function field(label,id,type='text',required=false){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.id=id;input.type=type;input.required=required;l.appendChild(input);return l;}
function drawSelected(){selected=chosen();const area=el('specific');area.replaceChildren();if(!selected){placeText('selection','Nessun caso selezionato');return;}
 const c=selected;placeText('selection',`${c.key} · ${c.match||''} · ${c.matchDate||''} · Stake originale: ${c.stake??c.actualStake??'N/D'} · ${c.review.status} · revisione ${c.review.revisions}${c.review.latest?.draftOutcome?' · Esito solo preliminare: '+c.review.latest.draftOutcome:''}`);
 if(c.kind==='CALCIO_SETTLEMENT'){area.append(field('Gol casa · risultato documentato','homeGoals','number',true));area.append(field('Gol ospite','awayGoals','number',true));}
 else if(c.kind==='TENNIS_SCHEDULE') {const l=document.createElement('label');l.textContent='Tipo di fonte dichiarata';const s=document.createElement('select');s.id='sourceKind';[['TOUR','Tour'],['TOURNAMENT','Torneo'],['OTHER','Altra']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;s.append(o);});l.append(s);area.append(l);}
 else {area.append(field('Motivo riconciliazione (senza correggere lo stake originale)','reconciliationReason','text',true));}
 if(c.review.latest){el('sourceUrl').value=c.review.latest.sourceUrl||'';el('sourceEventId').value=c.review.latest.sourceEventId||'';el('observedAt').value=c.review.latest.observedAt||'';}
}
async function load(){placeText('health','Lettura SQLite in sola lettura…');try{snapshot=await jsonFetch('/api/cases');const c=snapshot.counts;
 placeText('health',`SQLite: ${snapshot.dbQuickCheck} · Stato forward: ${snapshot.health.status} · Revisioni esterne: ${snapshot.ledgerEntries}`);
 el('counts').replaceChildren();for(const [label,n] of [['Calcio scaduti',c.staleCalcio],['Calendari Tennis',c.scheduleReview],['Contratti incoerenti',c.forwardContractReview],['Evidenze forward in ritardo',c.forwardEvidenceOverdue??'N/D']]){const s=document.createElement('span');s.className='count';s.textContent=label+': '+n;el('counts').append(s);}renderCases();
 }catch(e){placeText('health','ERRORE: '+e.message);}}
el('reload').addEventListener('click',load);el('filter').addEventListener('change',renderCases);el('search').addEventListener('input',renderCases);el('cases').addEventListener('change',drawSelected);
el('evidence').addEventListener('submit',async e=>{e.preventDefault();if(!selected){placeText('saveResult','Seleziona prima un caso');return;}
 let evidence={sourceUrl:val('sourceUrl'),sourceEventId:val('sourceEventId'),observedAt:val('observedAt'),notes:val('notes')};
 if(selected.kind==='CALCIO_SETTLEMENT'){evidence.homeGoals=val('homeGoals');evidence.awayGoals=val('awayGoals');}
 else if(selected.kind==='TENNIS_SCHEDULE')evidence.sourceKind=val('sourceKind');
 else evidence.reconciliationReason=val('reconciliationReason');
 try{const x=await jsonFetch('/api/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:selected.key,expectedRevision:selected.review.revisions,evidence})});
 placeText('saveResult','Salvata revisione '+x.entry.revision+'. Stato: '+x.status+(x.entry.evidence.draftOutcome?' · Esito preliminare: '+x.entry.evidence.draftOutcome:'')+'. Database invariato.');await load();
 }catch(err){placeText('saveResult','ERRORE: '+err.message);}});
el('preview').addEventListener('click',async()=>{const id=val('matchId');if(!/^[a-f0-9]{24}$/.test(id)){placeText('previewResult','Inserisci un identificatore editor valido di 24 caratteri');return;}
 try{const data=await jsonFetch('/api/edited-match?id='+encodeURIComponent(id));placeText('previewResult',JSON.stringify(data,null,2));}
 catch(e){placeText('previewResult','ERRORE: '+e.message);}});
load();
