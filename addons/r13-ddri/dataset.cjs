'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {evidenceReview,strictTime}=require('./provenance.cjs');
const columns=['tourney_id','tourney_name','surface','tourney_level','tourney_date','match_num','winner_name','loser_name','score','best_of'];
function csvParse(raw){
 if(typeof raw!=='string')throw Error('CSV_STRING_REQUIRED');if(raw.length>60e6)throw Error('CSV_TOO_LARGE');
 const rows=[];let r=[],v='',quoted=false;
 for(let i=0;i<raw.length;i++){const c=raw[i];if(c==='"'){if(quoted&&raw[i+1]==='"'){v+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){r.push(v);v='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&raw[i+1]==='\n')i++;r.push(v);v='';if(r.some(x=>x!==''))rows.push(r);r=[];}else v+=c;}
 if(quoted)throw Error('CSV_QUOTE_UNBALANCED');r.push(v);if(r.some(x=>x!==''))rows.push(r);return rows;
}
function validateDataset(csv,meta,{asOf,minRows=100}={}){
 const issues=[];const rows=csvParse(csv);if(!rows.length)return {status:'REJECTED',issues:['CSV_EMPTY']};
 const names=rows[0].map(s=>s.trim().replace(/^\uFEFF/,''));const missing=columns.filter(c=>!names.includes(c));if(missing.length)issues.push('CANONICAL_SCHEMA_MISSING:'+missing.join(','));if(!names.includes('match_end_utc'))issues.push('PREMATCH_MATCH_COMPLETION_TIMESTAMP_REQUIRED');
 const cut=strictTime(asOf);const obs=evidenceReview(meta,{decisionAsOf:asOf,maxAgeDays:21});if(!obs.ok)issues.push(...obs.reasons);
 const actualHash=crypto.createHash('sha256').update(csv,'utf8').digest('hex');if(meta?.artifactSha256!==actualHash)issues.push('DATASET_HASH_MISMATCH');
 if(rows.length-1<minRows)issues.push('DATASET_SAMPLE_TOO_SMALL');
 let latest=0,accepted=0;const seen=new Set();
 if(!missing.length)for(let i=1;i<rows.length;i++){
  const row=rows[i];if(row.length!==names.length){issues.push('CSV_COLUMN_COUNT_ROW_'+(i+1));continue;}
  const o=Object.fromEntries(names.map((key,j)=>[key,row[j]]));const date=String(o.tourney_date);
  if(!/^\d{8}$/.test(date)){issues.push('CSV_DATE_INVALID_ROW_'+(i+1));continue;}
  const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`,when=Date.parse(iso);
  if(!Number.isFinite(when)||new Date(when).toISOString().slice(0,10)!==iso.slice(0,10)){issues.push('CSV_DATE_INVALID_ROW_'+(i+1));continue;}
  if(when>cut){issues.push('FUTURE_TOURNAMENT_START_ROW_'+(i+1));continue;}
  const key=`${o.tourney_id}|${o.match_num}`;if(seen.has(key)){issues.push('DUPLICATE_MATCH_KEY_ROW_'+(i+1));continue;}seen.add(key);
  if(!o.winner_name||!o.loser_name||o.winner_name.toLowerCase()===o.loser_name.toLowerCase()||!['3','5'].includes(o.best_of)){issues.push('MATCH_FIELDS_INVALID_ROW_'+(i+1));continue;}
  if(!o.match_end_utc){issues.push('MATCH_END_UTC_MISSING_ROW_'+(i+1));continue;}
  const completed=Date.parse(o.match_end_utc);
  if(!Number.isFinite(completed)||!/^\d{4}-\d{2}-\d{2}T/.test(o.match_end_utc)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(o.match_end_utc)){issues.push('MATCH_END_TIMESTAMP_INVALID_ROW_'+(i+1));continue;}
  if(completed<when){issues.push('MATCH_END_BEFORE_TOURNAMENT_ROW_'+(i+1));continue;}
  if(completed>cut){issues.push('FUTURE_MATCH_LEAKAGE_ROW_'+(i+1));continue;}
  if(meta?.observedAt&&completed>Date.parse(meta.observedAt)){issues.push('MATCH_RESULT_AFTER_SOURCE_SNAPSHOT_ROW_'+(i+1));continue;}
  latest=Math.max(completed,latest);accepted++;
 }
 if(!latest)issues.push('NO_TEMPORALLY_PROVABLE_MATCHES');else if(cut-latest>21*86400000)issues.push('DATASET_MATCHES_STALE_21_DAYS');
 return {status:issues.length?'REJECTED':'CANDIDATE_VALIDATED_NOT_ACTIVATED',rows:rows.length-1,validRows:accepted,latestMatchAt:latest?new Date(latest).toISOString():null,actualHash,issues:[...new Set(issues)],notice:'Requires independent licensing verification and existing R11 Patch20/Patch21 staging/activation. Not activated here.'};
}
module.exports={columns,csvParse,validateDataset};
