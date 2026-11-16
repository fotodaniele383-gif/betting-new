'use strict';
// SAFE13_MANUAL_BATCH_R1: only explicit manual-paper routes; never scheduler/settlement/admin.
const ALLOWED_POST = new Set([
  '/api/analyze', '/api/calcio/deepscan', '/api/manual-deepscan',
  '/api/tennis/analyze', '/api/tennis/deepscan',
  '/api/calcio/portfolio/finalize-batch',
  '/api/calcio/probability-first/config', // CALCIO_PROBABILITY_FIRST_PATCH_V1
  '/api/calcio/probability-first/studio/record' // CALCIO_PF_STUDIO_V2_20261106
]);
const FINALIZE = '/api/calcio/portfolio/finalize-batch';
const BANNED_GET = /(?:^|\/)(?:refresh|import|sync|trigger|force|settle|reconcile|execute|migrate|send|bulk-action|finalize-batch)(?:\/|$)/;
function routeStatus(req) {
  const method = String(req.method || '').toUpperCase();
  const route = (String(req.path || req.url || '').split('?')[0].toLowerCase().replace(/\/+$/, '') || '/');
  if (!route.startsWith('/api/')) return {allow: true};
  // REAL_MANUAL_V1: allow only two manual ticket-writing endpoints, localhost + same-origin.
  if (method === 'POST' && (route === '/api/real-manual/tickets' || route === '/api/real-manual/settle')) {
    const port=String(process.env.PORT||'3188');
    const host=String(req.headers?.host||'').toLowerCase();
    const origin=String(req.headers?.origin||'').toLowerCase();
    const remote=String(req.socket?.remoteAddress||req.connection?.remoteAddress||'');
    const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
    if(process.env.SAFE13_MANUAL_PAPER==='1' && process.env.BETTING_DB_PATH &&
       ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote) && allowedHosts.includes(host) &&
       [`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)) return {allow:true};
    return {allow:false,status:403,code:'REAL_MANUAL_LOCAL_ORIGIN_REQUIRED'};
  }
  if (['GET','HEAD'].includes(method)) {
    return BANNED_GET.test(route) ? {allow:false,status:423,code:'SAFE13_MANUAL_GET_BLOCKED'} : {allow:true};
  }
  if (method === 'OPTIONS') return {allow: true};
  if (method !== 'POST' || !ALLOWED_POST.has(route)) return {allow:false,status:423,code:'SAFE13_MANUAL_ONLY'};
  if (route === '/api/calcio/probability-first/config' || route === '/api/calcio/probability-first/studio/record') {
    const port = String(process.env.PORT || '3188');
    const host = String(req.headers?.host || '').toLowerCase();
    const origin = String(req.headers?.origin || '').toLowerCase();
    const remote = String(req.socket?.remoteAddress || '');
    return process.env.SAFE13_MANUAL_PAPER === '1'
      && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)
      && [`127.0.0.1:${port}`,`localhost:${port}`].includes(host)
      && [`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)
      ? {allow:true} : {allow:false,status:403,code:'PF_LOCAL_ORIGIN_REQUIRED'};
  }
  if (route !== FINALIZE) return {allow:true};
  if (process.env.SAFE13_MANUAL_PAPER !== '1' || !process.env.BETTING_DB_PATH) return {allow:false,status:423,code:'SAFE13_BATCH_REQUIRES_ISOLATED_MANUAL_PAPER'};
  const port = String(process.env.PORT || '3188');
  const hosts = new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
  const host = String((req.headers || {}).host || '').toLowerCase();
  const origin = String((req.headers || {}).origin || '').toLowerCase();
  if (!hosts.has(host) || (origin && !hosts.has(origin.replace(/^http:\/\//,'').replace(/\/$/,''))) || (origin && !origin.startsWith('http://')))
    return {allow:false,status:403,code:'SAFE13_MANUAL_CROSS_ORIGIN_BLOCKED'};
  const remote = String(req.socket?.remoteAddress || req.connection?.remoteAddress || '');
  if (remote && !['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)) return {allow:false,status:403,code:'SAFE13_NON_LOOPBACK_DENIED'};
  return {allow:true};
}
function middleware(req,res,next) {
  const decision = routeStatus(req);
  if (decision.allow) return next();
  return res.status(decision.status).json({success:false,code:decision.code,error:decision.code,message:'SAFE13: richieste automatiche, settlement, gestione bankroll e configurazioni restano bloccate. Solo la finalizzazione del batch Calcio manuale è consentita.'});
}
module.exports = {routeStatus,middleware,ALLOWED_POST,FINALIZE};

// SAFE13_PORTFOLIO_READONLY_APPEND_R2_20261106: only the existing read-only Portfolio POST is excepted; other SAFE13 rules unchanged.
;(() => {
 'use strict';
 const _originalStatus=module.exports.routeStatus;
 const _originalMiddleware=module.exports.middleware;
 if(typeof _originalStatus!=='function'||typeof _originalMiddleware!=='function')throw Error('SAFE13_R2_MIDDLEWARE_CONTRACT');
 const pathName=req=>String((req&& (req.path||req.url))||'').split('?')[0].toLowerCase().replace(/\/+$/,'')||'/';
 const isReport=req=>String(req&&req.method||'').toUpperCase()==='POST'&&pathName(req)==='/api/trading-scopes/portfolio';
 const portfolioDecision=req=>{
   if(process.env.SAFE13_MANUAL_PAPER!=='1'||!process.env.BETTING_DB_PATH)return {allow:false,status:423,code:'SAFE13_PORTFOLIO_MANUAL_PAPER_REQUIRED'};
   const headers=req.headers||{};
   const contentType=String(headers['content-type']||'').split(';')[0].trim().toLowerCase();
   if(contentType!=='application/json')return {allow:false,status:415,code:'SAFE13_PORTFOLIO_JSON_REQUIRED'};
   const len=Number(headers['content-length']||0);
   if(!Number.isFinite(len)||len>1048576)return {allow:false,status:413,code:'SAFE13_PORTFOLIO_PAYLOAD_TOO_LARGE'};
   const site=String(headers['sec-fetch-site']||'').toLowerCase();
   if(site&&!['same-origin','none'].includes(site))return {allow:false,status:403,code:'SAFE13_PORTFOLIO_CROSS_SITE_DENIED'};
   const port=String(process.env.PORT||'3188');
   const hosts=new Set(['127.0.0.1:'+port,'localhost:'+port]);
   const host=String(headers.host||'').toLowerCase();
   const origin=String(headers.origin||'').toLowerCase();
   if(!hosts.has(host)||(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin)))return {allow:false,status:403,code:'SAFE13_PORTFOLIO_ORIGIN_DENIED'};
   const remote=String(req.socket&&req.socket.remoteAddress||req.connection&&req.connection.remoteAddress||'');
   if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return {allow:false,status:403,code:'SAFE13_PORTFOLIO_NON_LOOPBACK_DENIED'};
   return {allow:true};
 };
 module.exports.routeStatus=function(req){return isReport(req)?portfolioDecision(req):_originalStatus(req)};
 module.exports.middleware=function(req,res,next){
   if(!isReport(req))return _originalMiddleware(req,res,next);
   const decision=portfolioDecision(req);
   if(decision.allow)return next();
   return res.status(decision.status).json({success:false,code:decision.code,error:decision.code,message:'SAFE13: accesso Portfolio in sola lettura rifiutato.'});
 };
 module.exports.PORTFOLIO_R2_READ_ONLY=true;
})();
