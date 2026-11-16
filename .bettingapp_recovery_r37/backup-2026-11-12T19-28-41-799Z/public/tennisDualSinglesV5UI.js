/* TENNIS_DUAL_SINGLES_V5_R1 — read-only per-match simulation, no bet submission. */
(function () {
  'use strict';
  const URI = '/api/tennis/dual-singles-v5';
  const el = (tag, value, attrs) => {
    const x = document.createElement(tag);
    if (value !== undefined && value !== null) x.textContent=String(value);
    if (attrs) for (const [key,val] of Object.entries(attrs)) x.setAttribute(key,val);
    return x;
  };
  const add = (p,c) => (p.appendChild(c),c);
  const line = (p, text, strong) => add(p, el(strong?'strong':'div', text));
  const euro = (x) => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(x);
  const style = 'background:rgba(15,23,42,.65);color:#e2e8f0;border:1px solid #475569;border-radius:10px;padding:14px;margin:12px 0;';
  const itemStyle='padding:6px;margin:4px 0;background:#0f172a;border:1px solid #64748b;border-radius:5px;color:#fff;';
  const parseDecimal=(value)=>Number(String(value).trim().replace(',','.'));
  function input(parent,labelTxt,placeholder,value='') {
    const wrap = add(parent,el('label'));
    wrap.style='display:inline-flex;flex-direction:column;gap:4px;margin:4px 8px 6px 0;';
    add(wrap,el('span',labelTxt));
    const x=add(wrap,el('input',undefined,{type:'text',placeholder,autocomplete:'off'}));
    x.value=value; x.style=itemStyle;
    return x;
  }
  function button(parent,text,handler) {
    const b=add(parent,el('button',text,{type:'button'}));
    b.style='border:1px solid #5eead4;color:#5eead4;background:#11293b;border-radius:7px;padding:8px 12px;margin-right:10px;cursor:pointer;';
    b.addEventListener('click',handler); return b;
  }
  function resolveMatch(bet) {
    const raw=String(bet.match || bet.matchName || bet.event || '').trim();
    if (raw) return raw;
    const a=bet.player1 || bet.homePlayer || bet.home || '';
    const b=bet.player2 || bet.awayPlayer || bet.away || '';
    return a && b ? `${a} - ${b}` : 'Match Tennis (identità non disponibile)';
  }
  function render(data) {
    let panel = document.getElementById('tennisDualSinglesV5Panel');
    const resultRoot = document.getElementById('results');
    if (!resultRoot) return;
    if (!panel) {
      panel=el('section',null,{id:'tennisDualSinglesV5Panel','aria-label':'Tennis V5 copertura due singole'});
      panel.style=style+'border-left:4px solid #5eead4;';
      resultRoot.insertBefore(panel,resultRoot.firstChild);
    }
    // Tennis-only; no effect on Calcio, scheduler or paper trading.
    if (typeof activeSport !== 'undefined' && String(activeSport).toLowerCase() !== 'tennis') {
      panel.style.display='none'; return;
    }
    panel.style.display='block'; panel.replaceChildren();
    add(panel,el('h3','🎾 Tennis V5 · simulazione di due singole per match'));
    line(panel,'Simulazione (default 10 €) ≠ raccomandazione operativa. Le quote vanno verificate e inserite. Stake operativo: 0 €.');
    button(panel,'Copia prompt Tennis V5',async()=>{
      try { const r=await fetch(URI+'/prompt'); if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const s=await r.text(); await navigator.clipboard.writeText(s); alert('Prompt V5 copiato');
      } catch(e) {alert('Prompt non copiato: '+e.message)}
    });
    const matches=new Map();
    for(const b of [
      ...(Array.isArray(data?.valueBets)?data.valueBets:[]),
      ...(Array.isArray(data?.diagnostics?.bestAvailableForecasts)?data.diagnostics.bestAvailableForecasts:[])
    ]){
      if(!b || typeof b!=='object') continue;
      const key=resolveMatch(b);
      if(!matches.has(key)) matches.set(key,b);
    }
    if (!matches.size) {line(panel,'Nessun match analizzabile nel risultato corrente. La simulazione non inventa partite o quote.');return;}
    for(const [match,bet] of matches){
      const card=add(panel,el('article'));
      card.style=style;
      add(card,el('h4',match));
      const details=add(card,el('div'));
      details.style='display:flex;flex-wrap:wrap;align-items:flex-end;';
      const budget=input(details,'Budget (€)','10','10');
      const fav=input(details,'Favorito (nome)','Giocatore favorito');
      const dog=input(details,'Sfavorito (nome)','Avversario');
      const favOdds=input(details,'Quota favorito ML','1,30');
      const dogOdds=input(details,'Quota sfavorito +1,5 set','1,89');
      const bestOf=input(details,'Formato (3 o 5)','3','3');
      const action=add(card,el('div'));
      button(action,'Copia prompt per questo match',async()=>{
        try {
          const r=await fetch(URI+'/prompt'); if(!r.ok) throw new Error(`HTTP ${r.status}`);
          const base=await r.text();
          const context='\n\n=== MATCH CORRENTE (DA VERIFICARE) ===\n'+match+'\nCircuito/formato: verificare.\nQuota ML: '+(favOdds.value.trim()||'MANCANTE')+'\nQuota sfavorito +1,5 set: '+(dogOdds.value.trim()||'MANCANTE')+'\nBudget: '+(budget.value.trim()||'10')+' EUR\nVerifica autonomamente dati/quote e produci sempre le due singole candidate o NO BET.';
          await navigator.clipboard.writeText(base+context); alert('Prompt V5 per il match copiato');
        } catch(e) {alert('Impossibile copiare prompt match: '+e.message);}
      });
      const out=add(card,el('div','Quote mancanti: inserisci prezzi attuali e premi Simula. EV non certificato.'));
      out.style='padding-top:12px;white-space:pre-line;';
      button(action,'Simula due singole',async()=>{
        out.textContent='Verifica matematica…';
        const bValue=parseDecimal(budget.value);
        const fValue=parseDecimal(favOdds.value);
        const dValue=parseDecimal(dogOdds.value);
        const bof=Number(bestOf.value);
        // Empty fields must never be parsed as zero odds.
        if (!fav.value.trim() || !dog.value.trim() || !favOdds.value.trim() || !dogOdds.value.trim()) {
          out.textContent='DATI MANCANTI: nomi favorito/sfavorito e quote ML / +1,5 set obbligatorie.';return;
        }
        try {
          const r=await fetch(URI+'/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({budget:bValue,favoriteOdds:fValue,underdogPlus15Odds:dValue,bestOf:bof})});
          const result=await r.json();
          out.replaceChildren();
          if(!r.ok || result.status!=='SIMULATED') {
            line(out,'NON CALCOLABILE: '+(result.missing||[result.code]).join(', '));return;
          }
          line(out,`${euro(result.markets[0].simulatedStakeEur)} su ${fav.value.trim()} vincente @${fValue.toFixed(2)}`,true);
          line(out,`${euro(result.markets[1].simulatedStakeEur)} su ${dog.value.trim()} +1,5 set @${dValue.toFixed(2)}`,true);
          line(out,`Totale ${euro(result.budgetEur)} | Perdita massima ordinaria: ${euro(result.maximumOrdinaryLossEur)} (${result.maximumOrdinaryLossPct}%)`);
          for(const s of result.scenarios) line(out,`${s.label}: ${s.netProfitEur>=0?'+':''}${euro(s.netProfitEur)}`);
          line(out,result.lossTargetMet?'Target perdita ≤25% rispettato':'ATTENZIONE: target perdita ≤25% NON rispettato',true);
          line(out,'VERDETTO: NO BET · EV NON CERTIFICATO · STAKE OPERATIVO 0 €',true);
          line(out,'Quote inserite manualmente: NON sono state verificate automaticamente. Ritiro/abbandono soggetto alle regole del bookmaker.');
        } catch (e) {out.textContent='SIMULAZIONE NON DISPONIBILE: '+e.message;}
      });
    }
  }
  window.BettingTennisDualSinglesV5=Object.freeze({version:'TENNIS_DUAL_SINGLES_V5_R1',render});
})();
