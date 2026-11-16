'use strict';
/* R17: evidence-first Medical & News for Calcio. Qualitative only.
   Never converts a missing article into proof of fitness, and never
   changes production probabilities, settlement, portfolio or stake. */
const VERSION='BETTINGAPP_R17_MEDICAL_RELEVANCE_20261108';
const MEDICAL=new Set(['HARD_MEDICAL','MEDICAL','RETURN_FITNESS']);
const LINEUP=new Set(['LINEUP']);
const IN_SCOPE=new Set(['MEN_FIRST_TEAM','FIRST_TEAM','UNKNOWN']);
const ignoreTopic=/\b(?:official\s+(?:online\s+)?store|shop|merch(?:andise)?|jersey|jacket|shirt\s+collection|black\s+friday|ticket(?:ing)?|hospitality|sponsor(?:ship)?|academy|primavera|women(?:'s)?\s+team|femminile|under[\s-]?(?:1[5-9]|2[0-3]))\b/i;
function pureString(x){return typeof x==='string'?x:'';}
function dateValue(s){const x=Date.parse(pureString(s));return Number.isFinite(x)?x:null;}
function diagnostic(teamName, sourceIntelligence={}, options={}){
 const team=pureString(teamName), now=dateValue(options.asOf)||Date.now();
 const deferred=options.deferred===true;
 const articles=Array.isArray(sourceIntelligence.articles)?sourceIntelligence.articles:[];
 const accepted=[], rejected=[];
 for(const article of articles){
  const title=pureString(article.title||article.originalTitle).trim();
  const category=pureString(article.category).toUpperCase();
  const scope=pureString(article.squadScope).toUpperCase();
  const published=dateValue(article.publishedAt);
  const validTopic=MEDICAL.has(category)||LINEUP.has(category);
  const validScope=(!scope||IN_SCOPE.has(scope));
  const fresh=published!==null && published<=now+60000 && now-published<=14*86400000;
  const bad=ignoreTopic.test(title);
  if(!title||!validTopic||!validScope||!fresh||bad){
   rejected.push({title, reason:!validTopic?'NOT_MEDICAL_OR_LINEUP':!validScope?'NOT_MEN_FIRST_TEAM':!fresh?'STALE_OR_FUTURE':bad?'IRRELEVANT_MARKETING_OR_SQUAD':'NO_TITLE'});
   continue;
  }
  accepted.push({
   title,category,source:pureString(article.sourceName),publishedAt:article.publishedAt,
   url:pureString(article.sourceUrl||article.link),
   official:pureString(article.trustTier).toUpperCase()==='OFFICIAL',
   evidenceKind:MEDICAL.has(category)?'MEDICAL':'LINEUP_CONTEXT'
  });
 }
 // No article is evidence that a player is healthy or that a lineup is confirmed.
 const medical=accepted.filter(a=>a.evidenceKind==='MEDICAL');
 const lineup=accepted.filter(a=>a.evidenceKind==='LINEUP_CONTEXT');
 let status='NO_RELEVANT_MEDICAL_EVIDENCE';
 if(deferred)status='NEWS_DEFERRED';
 else if(medical.some(a=>a.official))status='OFFICIAL_MEDICAL_ARTICLE';
 else if(medical.length)status='MEDIA_MEDICAL_REPORT_UNCONFIRMED';
 else if(lineup.length)status='LINEUP_CONTEXT_ONLY';
 const count=sourceIntelligence.counts||{};
 return {
  version:VERSION,team,status,medicalArticles:deferred?0:medical.length,
  lineupContextArticles:deferred?0:lineup.length,
  officialMedicalArticles:deferred?0:medical.filter(a=>a.official).length,
  officialLineupArticles:deferred?0:lineup.filter(a=>a.official).length,
  scannedUniqueArticles:articles.length,
  providerArticleCount:Number(count.uniqueArticles||0),
  rejectedShown:rejected.slice(0,5),
  evidence:deferred?[]:accepted.slice(0,5),
  // These are COVERAGE indicators, not probabilities of fitness or truth.
  sourceCoveragePct:Number.isFinite(Number(sourceIntelligence.coverageConfidence))?Number(sourceIntelligence.coverageConfidence):null,
  sourceImpactPct:Number.isFinite(Number(sourceIntelligence.matchImpactConfidence))?Number(sourceIntelligence.matchImpactConfidence):null,
  report:deferred?'News rinviate dalla policy temporale: nessuna inferenza.':
   medical.some(a=>a.official)?'Fonte ufficiale su tema medico disponibile; verificare il contenuto e i giocatori interessati.':
   medical.length?'Notizie mediche giornalistiche: stato clinico da confermare.':
   lineup.length?'Notizie sulle formazioni, ma nessuna evidenza medica specifica verificata.':
   'Nessuna prova medica pertinente trovata; non significa rosa al completo.',
  medicalEvidenceVerified:!deferred&&medical.some(a=>a.official),
  // True for source relevance, NOT fitness / player availability.
  qualitativeOnly:true
 };
}
module.exports={VERSION,diagnostic};
