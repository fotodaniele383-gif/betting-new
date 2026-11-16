'use strict';
// R4: the editor is a dock; the AI/match table remains open and visible.
(()=>{
 const VERSION='BETTINGAPP_CALCIO_MAIN_R4_DOCK_20261109',BASE='/calcio-editor/';
 const css=document.createElement('style');css.textContent=`
  .r3-edit-controls{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}
  .r3-edit-btn{border:1px solid #64748b;background:#143452;color:#f8fafc;border-radius:5px;padding:6px 8px;font-size:11px;font-weight:700;cursor:pointer}
  .r3-edit-btn:hover,.r3-edit-btn:focus{background:#0e7490}
  .r3-manual-notice{color:#cbd5e1;font-size:10px;margin-top:5px;max-width:200px;line-height:1.35}
  .r4-dock{position:fixed;z-index:2147483600;right:0;top:0;bottom:0;width:min(53vw,980px);min-width:440px;background:#0e1729;color:#fff;box-shadow:-10px 0 40px #0009;border-left:2px solid #38bdf8;display:flex;flex-direction:column}
  .r4-dock[hidden]{display:none}.r4-head{display:flex;align-items:center;gap:7px;padding:10px 12px;background:#0e233e;flex-wrap:wrap}
  .r4-head strong{flex:1;font-size:13px}.r4-head button{border:1px solid #64748b;background:#203850;color:#fff;padding:8px 10px;border-radius:7px;cursor:pointer}
  .r4-frame{width:100%;flex:1;border:0;background:#080e1b}
  .r4-hint{font-size:11px;color:#a1b9d4;padding:5px 12px}
  @media(max-width:850px){.r4-dock{width:100vw;min-width:0}}
 `;document.head.appendChild(css);
 let dock=null,currentFrame=null;
 const prevent=e=>{e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();};
 function open(match,focus='quotes',sport='calcio',rowId=''){
  const url=BASE+'?match='+encodeURIComponent(match||'')+'&focus='+encodeURIComponent(focus)+'&sport='+encodeURIComponent(sport)+(rowId?'&rowId='+encodeURIComponent(rowId):'');
  if(!dock){dock=document.createElement('section');dock.className='r4-dock';dock.setAttribute('role','region');dock.setAttribute('aria-label','Editor Calcio affiancato');
   const header=document.createElement('div');header.className='r4-head';const heading=document.createElement('strong');heading.id='r4DockTitle';
   const outside=document.createElement('button');outside.type='button';outside.textContent='↗ Nuova scheda';
   outside.addEventListener('click',e=>{prevent(e);window.open(currentFrame?.src||url,'_blank','noopener,noreferrer');});
   const close=document.createElement('button');close.type='button';close.textContent='✕ Chiudi editor';close.addEventListener('click',e=>{prevent(e);dock.hidden=true;});
   header.append(heading,outside,close);const hint=document.createElement('div');hint.className='r4-hint';hint.textContent='L’analisi AI resta aperta a sinistra. L’editor usa la stessa partita.';
   const frame=document.createElement('iframe');frame.className='r4-frame';frame.title='Quote asiatiche e DeepScan Calcio';
   frame.setAttribute('referrerpolicy','no-referrer');dock.append(header,hint,frame);document.body.appendChild(dock);currentFrame=frame;
  }
  dock.hidden=false;dock.querySelector('#r4DockTitle').textContent='✏ '+(match||'Editor Calcio');currentFrame.src=url;
  // Never navigate away or replace the main match analysis page.
 }
 function button(label,handler){const b=document.createElement('button');b.className='r3-edit-btn';b.type='button';b.textContent=label;
  for(const event of ['pointerdown','mousedown'])b.addEventListener(event,e=>e.stopPropagation());
  b.addEventListener('click',e=>{prevent(e);handler();});return b;
 }
 function football(){if(typeof activeSport!=='undefined')return String(activeSport).toLowerCase()==='calcio';
  const tennis=document.getElementById('btnSportTennis');if(tennis?.getAttribute('aria-selected')==='true')return false;
  const selector=document.querySelector('#sportSelect,#sport,[name="sport"]');if(selector&&typeof selector.value==='string')return selector.value.toUpperCase()!=='TENNIS';return true;
 }
 function enhance(){const table=document.getElementById('valueBetsTable');if(!table)return;const calcio=football();
  for(const row of table.querySelectorAll('tr[id^="row-"]')){const cells=row.querySelectorAll(':scope > td');if(cells.length<14)continue;const matchCell=cells[1],stakeCell=cells[13];
   const match=matchCell?.querySelector('strong')?.textContent?.trim()||'';if(!match||!stakeCell)continue;const rowId=String(row.id||'').replace(/^row-/,'');
   let ctr=matchCell.querySelector('.r3-edit-controls');if(!ctr){ctr=document.createElement('div');ctr.className='r3-edit-controls';matchCell.appendChild(ctr);}
   if(ctr.dataset.match!==match||ctr.dataset.sport!==String(calcio)){
    ctr.replaceChildren();ctr.dataset.match=match;ctr.dataset.sport=String(calcio);
    if(calcio){ctr.append(button('✏ Quote asiatiche',()=>open(match,'quotes','calcio',rowId)),button('✏ Completa DeepScan',()=>open(match,'deepscan','calcio',rowId)),button('📋 Prompt Calcio H',()=>open(match,'prompt','calcio',rowId)));}
    else ctr.append(button('📋 Prompt Tennis H',()=>open(match,'prompt','tennis',rowId)));
    ctr.append(button('💶 Registra stake reale',()=>window.open('/real-manual.html?sport='+encodeURIComponent(calcio?'CALCIO':'TENNIS')+'&match='+encodeURIComponent(match),'_blank','noopener')));
   }
   if(!stakeCell.querySelector('.r3-manual-notice')){const note=document.createElement('div');note.className='r3-manual-notice';note.textContent='Il modello può proporre €0; importo reale soltanto a tua scelta.';stakeCell.appendChild(note);}
  }
 }
 let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}
 function watch(){const table=document.getElementById('valueBetsTable');if(!table){setTimeout(watch,300);return;}new MutationObserver(schedule).observe(table,{childList:true,subtree:true});schedule();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch,{once:true});else watch();
 window.BETTINGAPP_CALCIO_MAIN_R3={version:VERSION,openEditor:open};
})();
