(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ScopeRepairs=api;})(typeof globalThis==='object'?globalThis:this,function(){
'use strict';
function calibration(report){if(!report)return {};const c=report.calibration||report;return {...report,...c,buckets:Array.isArray(c.buckets)?c.buckets:[]};}
function eventTime(row){
 const raw=String(row.match_date||'').trim();
 let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/),y,mo,d;
 if(m){y=+m[1];mo=+m[2];d=+m[3];}
 else {m=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:,?\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);if(!m)return null;y=+m[3];mo=+m[2];d=+m[1];}
 const dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return null;
 if(raw.includes('T')){const n=Date.parse(raw);return Number.isFinite(n)?n:null;}
 const hh=raw.includes('/')?+(m[4]||0):0,mm=raw.includes('/')?+(m[5]||0):0,ss=raw.includes('/')?+(m[6]||0):0;
 return hh<24&&mm<60&&ss<60?dt.getTime()+(hh*3600+mm*60+ss)*1000:null;
}
function order(rows){const all=rows.every(r=>eventTime(r)!==null);return [...rows].sort((a,b)=>(all?eventTime(a)-eventTime(b):0)||Number(a.id)-Number(b.id));}
function orderNotice(rows){return rows.every(r=>eventTime(r)!==null)?'Ordine per data del match, non per data di liquidazione.':'Date mancanti o non valide: intero campione ordinato per ID; andamento cronologico non verificabile.';}
return {calibration,eventTime,order,orderNotice};
});
