'use strict';

const VERSION = 'TENNIS_CANONICAL_VENUE_REGISTRY_V1_PATCH39';

const VENUES = Object.freeze([
  Object.freeze({ id:'washington', catalogIds:['atp_500_washington','wta_500_washington'], aliases:['washington','dc open','mubadala citi dc open','citi open'], city:'Washington', country:'USA', latitude:38.9542, longitude:-77.0389, timeZone:'America/New_York', outdoor:true }),
  Object.freeze({ id:'montreal', catalogIds:['atp_m1000_canada'], aliases:['montreal','canada masters montreal','national bank open montreal'], city:'Montreal', country:'Canada', latitude:45.5354, longitude:-73.6270, timeZone:'America/Toronto', outdoor:true, yearParity:'ATP_EVEN_WTA_ODD' }),
  Object.freeze({ id:'toronto', catalogIds:['wta_1000_canada'], aliases:['toronto','canada toronto','national bank open toronto'], city:'Toronto', country:'Canada', latitude:43.7716, longitude:-79.5123, timeZone:'America/Toronto', outdoor:true, yearParity:'WTA_EVEN_ATP_ODD' }),
  Object.freeze({ id:'cincinnati', catalogIds:['atp_m1000_cincinnati','wta_1000_cincinnati'], aliases:['cincinnati','cincinnati open','mason'], city:'Mason', country:'USA', latitude:39.3557, longitude:-84.3144, timeZone:'America/New_York', outdoor:true }),
  Object.freeze({ id:'new_york', catalogIds:['atp_grand_slam_us_open','wta_grand_slam_us_open'], aliases:['us open','flushing meadows','new york'], city:'New York', country:'USA', latitude:40.7500, longitude:-73.8479, timeZone:'America/New_York', outdoor:true }),
  Object.freeze({ id:'wimbledon', catalogIds:['atp_grand_slam_wimbledon','wta_grand_slam_wimbledon'], aliases:['wimbledon','all england club'], city:'London', country:'United Kingdom', latitude:51.4343, longitude:-0.2145, timeZone:'Europe/London', outdoor:true }),
  Object.freeze({ id:'roland_garros', catalogIds:['atp_grand_slam_roland_garros','wta_grand_slam_roland_garros'], aliases:['roland garros','french open'], city:'Paris', country:'France', latitude:48.8470, longitude:2.2492, timeZone:'Europe/Paris', outdoor:true }),
  Object.freeze({ id:'melbourne', catalogIds:['atp_grand_slam_australian_open','wta_grand_slam_australian_open'], aliases:['australian open','melbourne'], city:'Melbourne', country:'Australia', latitude:-37.8217, longitude:144.9786, timeZone:'Australia/Melbourne', outdoor:true }),
  Object.freeze({ id:'rome', catalogIds:['atp_m1000_rome','wta_1000_rome'], aliases:['roma','rome','internazionali d italia','italian open'], city:'Rome', country:'Italy', latitude:41.9290, longitude:12.4563, timeZone:'Europe/Rome', outdoor:true }),
  Object.freeze({ id:'madrid', catalogIds:['atp_m1000_madrid','wta_1000_madrid'], aliases:['madrid','mutua madrid'], city:'Madrid', country:'Spain', latitude:40.3686, longitude:-3.6840, timeZone:'Europe/Madrid', outdoor:true }),
  Object.freeze({ id:'indian_wells', catalogIds:['atp_m1000_indian_wells','wta_1000_indian_wells'], aliases:['indian wells','bnp paribas open'], city:'Indian Wells', country:'USA', latitude:33.7237, longitude:-116.3056, timeZone:'America/Los_Angeles', outdoor:true }),
  Object.freeze({ id:'miami', catalogIds:['atp_m1000_miami','wta_1000_miami'], aliases:['miami','miami open'], city:'Miami Gardens', country:'USA', latitude:25.9580, longitude:-80.2389, timeZone:'America/New_York', outdoor:true })
]);

function normalize(value='') { return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }
function tourOf(context={}) { const t=[context.tour,context.tour_type,context.tourType,context.league,context.bet_type].filter(Boolean).join(' ').toUpperCase(); return t.includes('WTA')?'WTA':t.includes('ATP')?'ATP':'UNKNOWN'; }
function yearOf(context={}) { const raw=context.canonical_match_datetime||context.match_date||context.commence_time||context.date; const d=new Date(raw); if(Number.isFinite(d.getTime()))return d.getUTCFullYear(); const m=String(raw||'').match(/\b(20\d{2})\b/); return m?Number(m[1]):new Date().getUTCFullYear(); }
function parityVenue(context={}) {
  const tour=tourOf(context), year=yearOf(context), text=normalize([context.tournament_name,context.tournamentName,context.tournament,context.league].filter(Boolean).join(' '));
  const catalog=String(context.tournament_catalog_id||context.tournamentCatalogId||'').toLowerCase();
  const canada=catalog.includes('canada')||text.includes('canada')||text.includes('national bank');
  if(!canada||!['ATP','WTA'].includes(tour))return null;
  const even=year%2===0;
  const city=(tour==='ATP'&&even)||(tour==='WTA'&&!even)?'montreal':'toronto';
  return VENUES.find(v=>v.id.startsWith(city))||null;
}
function resolveVenue(context={}) {
  if(context.surface_indoor===1||context.indoor===true||normalize(context.surface).includes('indoor')) return {version:VERSION,status:'INDOOR_NO_WEATHER',outdoor:false,authority:'CANONICAL_REGISTRY'};
  const catalog=String(context.tournament_catalog_id||context.tournamentCatalogId||'').toLowerCase();
  if(catalog){const exact=VENUES.find(v=>v.catalogIds.some(id=>id===catalog));if(exact)return {...exact,version:VERSION,status:'RESOLVED_CANONICAL_ID',authority:'CANONICAL_REGISTRY'};}
  const parity=parityVenue(context);if(parity)return {...parity,version:VERSION,status:'RESOLVED_TOUR_YEAR_ROTATION',authority:'CANONICAL_REGISTRY'};
  const text=normalize([context.tournament_name,context.tournamentName,context.tournament_canonical_name,context.tournament,context.eventName,context.league].filter(Boolean).join(' '));
  const matches=VENUES.filter(v=>v.aliases.some(alias=>text.includes(normalize(alias))));
  if(matches.length===1)return {...matches[0],version:VERSION,status:'RESOLVED_ALIAS',authority:'CANONICAL_REGISTRY'};
  if(matches.length>1)return {version:VERSION,status:'AMBIGUOUS_VENUE',outdoor:null,candidates:matches.map(v=>v.id),authority:'NO_WEATHER'};
  return {version:VERSION,status:'VENUE_UNRESOLVED',outdoor:null,authority:'NO_WEATHER'};
}
function health(){return{version:VERSION,venues:VENUES.length,canadaRotation:true,authority:'WEATHER_ROUTING_ONLY',probabilityAuthority:false,stakeAuthority:false};}
module.exports={VERSION,VENUES,normalize,tourOf,yearOf,resolveVenue,health};
