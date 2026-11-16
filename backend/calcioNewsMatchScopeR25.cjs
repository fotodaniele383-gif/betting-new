'use strict';
const V='R25_CALCIO_NEWS_MATCH_RELEVANCE_V1';
function normalized(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()}
const ALIASES=Object.freeze({'newcastle united':['newcastle','newcastle united'], 'arsenal':['arsenal'], 'manchester city':['man city','manchester city'], 'manchester united':['man utd','manchester united'], 'ac milan':['ac milan','milan'], 'as roma':['as roma','roma'], 'inter milan':['inter milan','inter'], 'tottenham hotspur':['tottenham','spurs'], 'bologna':['bologna']});
function mentions(text,team){const norm=normalized(text),name=normalized(team);const aliases=ALIASES[name]||[name];return aliases.some(a=>a.length>=4&&new RegExp('(?:^|\\s)'+a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|\\s)').test(norm))}
function classify(article={},team='',opponent='',asOf=null){
 const text=String(article.title||'')+' '+String(article.fullText||'');
 const date=Date.parse(String(article.publishedAt||article.pubDate||'')),cutoff=asOf==null?null:Date.parse(String(asOf));
 if(cutoff!==null&&Number.isFinite(cutoff)&&Number.isFinite(date)&&date>cutoff)return {scope:'REJECT_FUTURE_PUBLICATION',matchImpact:false,version:V};
 if(!mentions(text,team))return {scope:'NOT_TEAM_RELEVANT',matchImpact:false,version:V};
 if(!opponent||!mentions(String(article.title||''),opponent))return {scope:'TEAM_CONTEXT_ONLY',matchImpact:false,version:V};
 return {scope:'MATCH_CANDIDATE',matchImpact:true,version:V};
}
module.exports={V,mentions,classify};
