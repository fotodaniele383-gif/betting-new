// PATCH57_PRODUCTION_SECURITY_REMOTE_SESSION
(function installPatch57TelegramRemoteSession(){
    const KEY='BETTINGAPP_PATCH57_REMOTE_ACCESS_TOKEN';
    try {
        const hash=new URLSearchParams(String(window.location.hash||'').replace(/^#/,''));
        const token=String(hash.get('access_token')||'').trim();
        if(token.length>=32){sessionStorage.setItem(KEY,token);history.replaceState(null,document.title,window.location.pathname+window.location.search);}
    } catch(_) {}
})();
function patch57TelegramHeaders(base={}){ const h={...base}; try{const t=String(sessionStorage.getItem('BETTINGAPP_PATCH57_REMOTE_ACCESS_TOKEN')||'').trim();if(t)h['X-BettingApp-Token']=t;}catch(_){} return h; }
const $ = id => document.getElementById(id);
function boolVal(id){ return $(id).value === 'true'; }
function getOptions(){ return { mode:$('mode').value, area:$('area').value, sport:$('sport').value, stakeScope:$('stakeScope').value, limit:Number($('limit').value||20), onlyCurrentDataQuality:boolVal('onlyCurrentDataQuality'), dedupe:boolVal('dedupe') }; }
function contactsFromText(){ return $('contactsText').value.split(/\n+/).map((line,idx)=>line.trim()).filter(Boolean).map((line,idx)=>{ const [name='', chatId='', enabled='true'] = line.split('|').map(s=>s.trim()); return { id: chatId || `contact_${idx+1}`, name: name || `Contatto ${idx+1}`, chatId, enabled: enabled !== 'false' && enabled !== '0' && enabled.toLowerCase() !== 'no' }; }); }
function contactsToText(contacts=[]){ return contacts.map(c=>`${c.name||''}|${c.chatId||''}|${c.enabled!==false}`).join('\n'); }
async function api(path, opts={}){ const res=await fetch(path,{...opts,headers:patch57TelegramHeaders({'Content-Type':'application/json',...(opts.headers||{})})}); const json=await res.json().catch(()=>({success:false,error:'Risposta non JSON'})); if(!res.ok || json.success===false) throw new Error(json.error||json.reason||`HTTP ${res.status}`); return json; }
function print(obj){ $('previewBox').textContent = typeof obj === 'string' ? obj : JSON.stringify(obj,null,2); }
function setStatus(text, ok=true){ $('statusBox').innerHTML = `<span class="${ok?'ok':'bad'}">${text}</span>`; }
async function loadStatus(){ try{ const j=await api('/api/telegram/status'); const cfg=j.config||{}; setStatus(`Modulo: ${j.mode}\nCredenziale: ${cfg.tokenConfigured?'configurata in ambiente':'NON configurata'}\nPolicy: ${cfg.credentialSource||'ENVIRONMENT_ONLY'}\nRotazione richiesta: ${cfg.rotationRequired?'SÌ - invio bloccato':'No'}\nContatti: ${(cfg.contacts||[]).length}\nConfig non sensibile: ${cfg.configPath}`, !cfg.rotationRequired); $('contactsText').value=contactsToText(cfg.contacts||[]); const f=cfg.defaultFilters||{}; ['mode','area','sport','stakeScope'].forEach(k=>{ if(f[k] && $(k)) $(k).value=f[k]; }); if(f.limit) $('limit').value=f.limit; if(f.onlyCurrentDataQuality!==undefined) $('onlyCurrentDataQuality').value=String(f.onlyCurrentDataQuality); if(f.dedupe!==undefined) $('dedupe').value=String(f.dedupe); }catch(e){ setStatus(e.message,false); } }
async function saveConfig(){ const body={ contacts:contactsFromText(), defaultFilters:getOptions() }; const j=await api('/api/telegram/config',{method:'POST',body:JSON.stringify(body)}); print(j); await loadStatus(); }
async function preview(){ const j=await api('/api/telegram/preview',{method:'POST',body:JSON.stringify(getOptions())}); print((j.messages||[]).join('\n\n---\n\n')); }
async function send(){ if(!confirm('Inviare davvero i messaggi Telegram ai contatti abilitati?')) return; const j=await api('/api/telegram/send',{method:'POST',body:JSON.stringify(getOptions())}); print(j); await loadStatus(); }
async function testSend(){ const j=await api('/api/telegram/test',{method:'POST',body:JSON.stringify({})}); print(j); }
async function resetState(){ if(!confirm('Azzerare lo stato anti-duplicati Telegram?')) return; const j=await api('/api/telegram/reset-state',{method:'POST',body:JSON.stringify({confirm:true})}); print(j); }
window.addEventListener('DOMContentLoaded',()=>{ $('saveConfigBtn').onclick=()=>saveConfig().catch(e=>print({success:false,error:e.message})); $('previewBtn').onclick=()=>preview().catch(e=>print({success:false,error:e.message})); $('sendBtn').onclick=()=>send().catch(e=>print({success:false,error:e.message})); $('testBtn').onclick=()=>testSend().catch(e=>print({success:false,error:e.message})); $('resetStateBtn').onclick=()=>resetState().catch(e=>print({success:false,error:e.message})); loadStatus(); });
