(function(){
'use strict';
const VERSION='AUDIT16D_R3_T10_R1_SHADOW_MONITOR_UI_V1';
const ENDPOINT='/api/tennis/t10-shadow-monitor';
let timer=null, inFlight=null, lastData=null;
const el=id=>document.getElementById(id);
const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'N/D';
const pp=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${num(v,2)} pp`:'N/D';
const score=v=>Number.isFinite(Number(v))?num(v,6):'N/D';
const pct=v=>Number.isFinite(Number(v))?`${num(v,1)}%`:'N/D';
function tennisActive(){ try { return typeof activeSport!=='undefined' && String(activeSport).toLowerCase()==='tennis'; } catch(_){ return false; } }
function portfolioVisible(){ const s=el('portfolioSection'); return Boolean(s && !s.classList.contains('hidden')); }
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function injectStyle(){if(el('t10r1ShadowStyle'))return;const s=document.createElement('style');s.id='t10r1ShadowStyle';s.textContent=`
#t10r1ShadowPanel{margin:16px 0 18px;border:1px solid rgba(168,85,247,.42);border-left:4px solid #a855f7;background:linear-gradient(145deg,rgba(88,28,135,.16),rgba(15,23,42,.86));border-radius:14px;padding:15px;box-shadow:0 12px 26px rgba(2,6,23,.20)}
.t10r1-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.t10r1-title{font-weight:900;color:#e9d5ff;font-size:1.02rem}.t10r1-sub{color:#cbd5e1;font-size:.82rem;margin-top:4px;line-height:1.4}.t10r1-badge{padding:6px 9px;border-radius:999px;font-size:.72rem;font-weight:900;border:1px solid rgba(168,85,247,.55);background:rgba(168,85,247,.12);color:#e9d5ff}.t10r1-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin-top:13px}.t10r1-kpi{background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.18);border-radius:10px;padding:10px}.t10r1-kpi span{display:block;color:#94a3b8;text-transform:uppercase;font-size:.67rem;font-weight:800}.t10r1-kpi strong{display:block;color:#f8fafc;font-size:1.15rem;margin-top:4px}.t10r1-progress{margin-top:13px;background:rgba(15,23,42,.72);border:1px solid rgba(148,163,184,.18);padding:10px;border-radius:10px}.t10r1-track{height:11px;background:#0f172a;border:1px solid #334155;border-radius:999px;overflow:hidden}.t10r1-fill{height:100%;background:linear-gradient(90deg,#8b5cf6,#22d3ee);width:0}.t10r1-milestones{display:flex;justify-content:space-between;color:#94a3b8;font-size:.7rem;margin-top:5px}.t10r1-table{width:100%;min-width:650px;border-collapse:collapse}.t10r1-table th,.t10r1-table td{padding:7px;border-bottom:1px solid rgba(148,163,184,.13);font-size:.78rem}.t10r1-table th{color:#c4b5fd;background:rgba(15,23,42,.60)}.t10r1-table td{color:#e2e8f0}.t10r1-scroll{overflow-x:auto;margin-top:12px;border:1px solid rgba(148,163,184,.16);border-radius:10px}.t10r1-foot{margin-top:10px;color:#94a3b8;font-size:.75rem;line-height:1.4}.t10r1-refresh{border:1px solid #a855f7;background:rgba(168,85,247,.14);color:#e9d5ff;border-radius:8px;padding:7px 10px;cursor:pointer;font-weight:800}.t10r1-warn{color:#fbbf24}.t10r1-good{color:#6ee7b7}.t10r1-muted{color:#94a3b8}
`;document.head.appendChild(s);}
function ensurePanel(){
  injectStyle(); let p=el('t10r1ShadowPanel'); if(p)return p;
  const section=el('portfolioSection'); if(!section)return null;
  p=document.createElement('div');p.id='t10r1ShadowPanel';p.className='hidden';p.innerHTML='<div class="t10r1-head"><div><div class="t10r1-title">🧪 T10 Shadow Monitor · calibrazione congelata</div><div class="t10r1-sub">Monitor read-only delle candidate T10 congelate a HOLDOUT=50. Nessuna modifica a probabilità, stake, gate o modello.</div></div><button type="button" id="t10r1ShadowRefresh" class="t10r1-refresh">↻ Aggiorna monitor</button></div><div id="t10r1ShadowBody" class="t10r1-sub" style="margin-top:12px">Caricamento…</div>';
  const header=section.querySelector('.header-flex'); if(header) header.insertAdjacentElement('afterend',p); else section.prepend(p);
  el('t10r1ShadowRefresh')?.addEventListener('click',()=>refresh(true)); return p;
}
function candidateRow(label,obj){
  const m=obj?.metrics||{}, sig=obj?.signal?.state||'N/D', boot=obj?.bootstrapVsIdentity;
  const blo=boot?.brierImprovement95?.[0], llo=boot?.logLossImprovement95?.[0];
  const robust=Number.isFinite(Number(blo))&&Number(blo)>0&&Number.isFinite(Number(llo))&&Number(llo)>0;
  return `<tr><td><strong>${esc(label)}</strong></td><td>${score(m.brier)}</td><td>${score(m.logLoss)}</td><td>${pp(m.calibrationBiasPp)}</td><td>${score(m.ece10)}</td><td class="${robust?'t10r1-good':'t10r1-muted'}">${esc(sig)}</td></tr>`;
}
function render(data){
  const p=ensurePanel(); if(!p)return; p.classList.toggle('hidden',!tennisActive()); if(!tennisActive())return;
  const b=el('t10r1ShadowBody'); if(!b)return;
  if(!data||data.success===false){b.innerHTML=`<span class="t10r1-warn">Monitor non disponibile: ${esc(data?.error||data?.status||'errore sconosciuto')}</span>`;return;}
  const pr=data.progress||{}, ev=data.evidence||{}, cur=data.current||{}, clv=ev.clv||{};
  const status=data.state||'MONITORING'; const progress=Math.max(0,Math.min(100,Number(pr.preferredProgressPct||0)));
  b.innerHTML=`
  <div class="t10r1-head"><span class="t10r1-badge">${esc(status)}</span><span class="t10r1-muted">Freeze T10: HOLDOUT 50 · target preferito 100</span></div>
  <div class="t10r1-grid">
    <div class="t10r1-kpi"><span>HOLDOUT</span><strong>${esc(pr.holdoutSettled)}/100</strong></div>
    <div class="t10r1-kpi"><span>Nuovi dal freeze</span><strong>+${esc(pr.newHoldoutSinceFreeze)}</strong></div>
    <div class="t10r1-kpi"><span>Mancano a 75</span><strong>${esc(pr.remainingTo75)}</strong></div>
    <div class="t10r1-kpi"><span>Mancano a 100</span><strong>${esc(pr.remainingTo100)}</strong></div>
    <div class="t10r1-kpi"><span>CLV HOLDOUT verificato</span><strong>${esc(clv.verifiedHoldout??'N/D')} · ${Number.isFinite(Number(clv.verifiedHoldoutPct))?num(clv.verifiedHoldoutPct,1)+'%':'N/D'}</strong></div>
    <div class="t10r1-kpi"><span>Bias modello attuale</span><strong>${pp(cur.identity?.metrics?.calibrationBiasPp)}</strong></div>
  </div>
  <div class="t10r1-progress"><div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:7px"><strong>Avanzamento campione preferito</strong><span>${pct(progress)}</span></div><div class="t10r1-track"><div class="t10r1-fill" style="width:${progress}%"></div></div><div class="t10r1-milestones"><span>50 minimo audit</span><span>75 verifica intermedia</span><span>100 review preferita</span></div></div>
  <div class="t10r1-scroll"><table class="t10r1-table"><thead><tr><th>Modello shadow</th><th>Brier ↓</th><th>LogLoss ↓</th><th>Bias</th><th>ECE ↓</th><th>Stato</th></tr></thead><tbody>
    ${candidateRow('Identity · modello operativo',cur.identity)}
    ${candidateRow('Market benchmark',cur.market)}
    ${candidateRow('Logit-V1 congelato',cur.logitV1)}
    ${candidateRow('Platt-V1 congelato',cur.plattV1)}
  </tbody></table></div>
  <div class="t10r1-foot"><strong>SHADOW ONLY.</strong> I parametri Logit/Platt sono quelli congelati da T10 a HOLDOUT=50 e non vengono riaddestrati. Anche a HOLDOUT=100 il monitor non può cambiare modello o stake. Ultimo aggiornamento: ${esc(data.generatedAt||'N/D')}.</div>`;
}
async function refresh(force){
  const p=ensurePanel(); if(!p)return; p.classList.toggle('hidden',!tennisActive()); if(!tennisActive()||!portfolioVisible())return;
  if(inFlight && !force)return inFlight;
  if(inFlight&&force){try{inFlight.abort?.();}catch(_){}}
  const ctl=new AbortController();
  inFlight=fetch(ENDPOINT,{cache:'no-store',signal:ctl.signal,headers:{'Accept':'application/json'}}).then(r=>r.json().then(j=>({r,j}))).then(({r,j})=>{if(!r.ok&&j.success!==false)j.success=false;lastData=j;render(j);return j;}).catch(err=>{if(err?.name!=='AbortError')render({success:false,error:err?.message||String(err)});}).finally(()=>{inFlight=null;});
  inFlight.abort=()=>ctl.abort(); return inFlight;
}
function sync(){const p=ensurePanel();if(!p)return;p.classList.toggle('hidden',!(tennisActive()&&portfolioVisible()));if(tennisActive()&&portfolioVisible())refresh(false);}
function boot(){ensurePanel();el('portfolioBtn')?.addEventListener('click',()=>setTimeout(sync,0));el('refreshPortfolioBtn')?.addEventListener('click',()=>setTimeout(()=>refresh(true),0));const ps=el('portfolioSection');if(ps&&window.MutationObserver)new MutationObserver(sync).observe(ps,{attributes:true,attributeFilter:['class']});timer=setInterval(()=>{if(tennisActive()&&portfolioVisible())refresh(false);},60000);sync();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
window.T10ShadowMonitorUI={VERSION,refresh:()=>refresh(true),getLastData:()=>lastData};
})();
