'use strict';
// R12: una fonte raggiungibile e ufficiale NON basta a dimostrare che un articolo
// riguardi la prima squadra maschile. Fail-closed solo su indizi espliciti.
const R12_NEWS_SCOPE_VERSION = 'BETTING_R12_NEWS_FIRST_TEAM_SCOPE_V1';
const EXPLICIT_WOMEN = [
  /\bwomen(?:\s*'?s)?\b/i, /\bfemminil[ei]\b/i,
  /\bserie\s*a\s*(?:women|femminile)\b/i, /\bcalcio\s*femminile\b/i,
  /\bprima\s+squadra\s+femminile\b/i, /\b(?:wsl|liga f)\b/i,
];
const EXPLICIT_YOUTH = [
  /\bprimavera\b/i, /\bsettore\s+giovanile\b/i, /\byouth\s+(?:team|sector|academy|squad)\b/i,
  /\bunder[-\s]?(?:9|10|11|12|13|14|15|16|17|18|19|20|21|23)(?:s|'s)?\b/i,
  /\bu[-\s]?(?:9|10|11|12|13|14|15|16|17|18|19|20|21|23)\b/i,
  /\bacademy\b/i, /\bjunior(?:s)?\b/i, /\bnext\s*gen\b/i,
  /\bmilan\s+futuro\b/i, /\bfuture\s+team\b/i,
];
// Questo nominativo e' confermato dalla pubblicazione ufficiale del Milan
// (26/10/2026) relativa alla squadra femminile. Non dedurre il settore dal nome
// di altre persone.
const VERIFIED_NON_MENS_SUBJECTS = Object.freeze([
  {team:/\b(?:ac\s+)?milan\b/i, subject:/\bjulie\s+piga\b/i, scope:'WOMEN', reason:'VERIFIED_WOMEN_TEAM_SUBJECT'},
]);
function classifyNewsScope(article={},teamName='',base={}) {
  const raw=[article.title,article.originalTitle,article.fullText,article.sourceUrl,article.link].filter(Boolean).join(' ').slice(0,45000);
  if (EXPLICIT_WOMEN.some(pattern=>pattern.test(raw))) return {scope:'WOMEN',reason:'EXPLICIT_WOMEN_TEAM_CONTEXT',subjectResolution:null};
  if (EXPLICIT_YOUTH.some(pattern=>pattern.test(raw))) return {scope:'ACADEMY',reason:'EXPLICIT_YOUTH_OR_RESERVE_CONTEXT',subjectResolution:null};
  for(const item of VERIFIED_NON_MENS_SUBJECTS){
    if(item.team.test(String(teamName)) && item.subject.test(raw)) return {scope:item.scope,reason:item.reason,subjectResolution:{verified:true}};
  }
  // Conservarne l'eventuale classificazione piu' restrittiva legacy.
  if(base&&base.scope && base.scope!=='MEN_FIRST_TEAM')return base;
  return base&&base.scope?base:{scope:'MEN_FIRST_TEAM',reason:null,subjectResolution:null};
}
module.exports={R12_NEWS_SCOPE_VERSION,classifyNewsScope};
