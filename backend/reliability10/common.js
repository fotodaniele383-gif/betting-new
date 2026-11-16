'use strict';
const VERSION='RELIABILITY10_20261109';
function number(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function first(obj,keys){for(const key of keys){const value=obj?.[key];if(value!==null&&value!==undefined&&value!=='')return value;}return null;}
function pct(value){const n=number(value);return n!==null&&n>=0&&n<=100?n:null;}
function odd(value){const n=number(value);return n!==null&&n>1&&n<1001?n:null;}
function instant(value){if(value==null||value==='')return {status:'MISSING',ms:null}; const s=String(value).trim();if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(s)) return {status:'TZ_UNKNOWN',ms:null};const ms=Date.parse(s);return Number.isFinite(ms)?{status:'VALID',ms}:{status:'INVALID',ms:null};}
function observedDate(x){return instant(first(x,['observedAt','capturedAt','asOf','timestamp','createdAt']));}
function periodCheck(capture,kickoff,prematch){const a=instant(capture),b=instant(kickoff);const reasons=[],warnings=[];if(a.status==='MISSING'||b.status==='MISSING')warnings.push('TIME_EVIDENCE_MISSING');else if(a.status!=='VALID'||b.status!=='VALID')warnings.push('TIME_ZONE_NOT_VERIFIED');else if(a.ms>=b.ms){if(prematch)reasons.push('POST_START_PREMATCH_EVIDENCE');else warnings.push('EVIDENCE_NOT_PREMATCH');}return {reasons,warnings,capture:a.status,kickoff:b.status};}
function unique(a){return [...new Set(a.filter(Boolean))];}
function grade(gates){const g=Object.values(gates);return {verified:g.filter(x=>x===true).length,total:g.length,unknown:g.filter(x=>x===null).length,failed:g.filter(x=>x===false).length};}
function result(parts){return {version:VERSION,hardReasons:unique(parts.flatMap(x=>x.hardReasons||x.reasons||[])),warnings:unique(parts.flatMap(x=>x.warnings||[])),components:parts};}
module.exports={VERSION,number,first,pct,odd,instant,observedDate,periodCheck,unique,grade,result};
