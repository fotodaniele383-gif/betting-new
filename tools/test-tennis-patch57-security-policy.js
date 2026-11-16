#!/usr/bin/env node
'use strict';
const path=require('path');
const root=path.resolve(process.argv.includes('--root')?process.argv[process.argv.indexOf('--root')+1]||'.':process.argv[2]||path.join(__dirname,'..'));
const s=require(path.join(root,'backend','productionSecuritySafeReleasePatch57'));
const checks=[]; const c=(name,ok,details=null)=>checks.push({name,ok:Boolean(ok),details});
function response(){return {statusCode:200,headers:{},body:null,ended:false,setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;this.ended=true;return this;},end(){this.ended=true;return this;}}}
function run(mw,req){const res=response();let next=false;mw(req,res,()=>{next=true});return {res,next};}
const local=s.resolveRuntimeConfig({env:{}});
c('Default loopback',local.bindHost==='127.0.0.1'&&local.loopbackBind===true,s.safeRuntimeConfig(local));
c('Default remote disabled',local.remoteAccessEnabled===false&&local.ready===true);
c('Token never exposed',!Object.prototype.hasOwnProperty.call(s.safeRuntimeConfig(local),'_remoteToken')&&s.safeRuntimeConfig(local).remoteTokenExposed===false);
const unsafe=s.resolveRuntimeConfig({env:{BETTINGAPP_BIND_HOST:'0.0.0.0'}});
c('Non-loopback fails closed',unsafe.ready===false);
const remoteWeak=s.resolveRuntimeConfig({env:{BETTINGAPP_REMOTE_ACCESS_ENABLED:'1',BETTINGAPP_REMOTE_ACCESS_TOKEN:'weak'}});
c('Remote weak token blocked',remoteWeak.ready===false&&remoteWeak.remoteTokenConfigured===false);
const token='A'.repeat(40)+'9z!';
const remote=s.resolveRuntimeConfig({env:{BETTINGAPP_REMOTE_ACCESS_ENABLED:'1',BETTINGAPP_REMOTE_ACCESS_TOKEN:token}});
c('Remote strong token accepted',remote.ready===true&&remote.remoteTokenConfigured===true);
const localReq={method:'GET',path:'/api/health',headers:{host:'127.0.0.1:3000'},socket:{remoteAddress:'127.0.0.1'}};
let x=run(s.accessControlMiddleware(local),localReq);c('Local direct API no token required',x.next===true&&x.res.statusCode===200);
const proxied={method:'GET',path:'/api/health',headers:{host:'127.0.0.1:3000','x-forwarded-for':'203.0.113.9','x-forwarded-host':'demo.ngrok.app','x-forwarded-proto':'https'},socket:{remoteAddress:'127.0.0.1'}};
x=run(s.accessControlMiddleware(local),proxied);c('Forwarded tunnel blocked when remote disabled',x.next===false&&x.res.statusCode===403&&x.res.body?.code==='PATCH57_REMOTE_ACCESS_DISABLED');
x=run(s.accessControlMiddleware(remote),proxied);c('Remote missing token unauthorized',x.res.statusCode===401&&x.res.body?.code==='PATCH57_REMOTE_AUTH_REQUIRED');
const authReq={...proxied,headers:{...proxied.headers,'x-bettingapp-token':token}};x=run(s.accessControlMiddleware(remote),authReq);c('Remote valid token accepted',x.next===true);
const badOrigin={...localReq,headers:{...localReq.headers,origin:'https://evil.invalid'}};x=run(s.corsMiddleware(local),badOrigin);c('Cross-origin arbitrary blocked',x.res.statusCode===403&&x.res.body?.code==='PATCH57_ORIGIN_BLOCKED');
const goodOrigin={...localReq,headers:{...localReq.headers,origin:'http://127.0.0.1:3000'}};x=run(s.corsMiddleware(local),goodOrigin);c('Configured local origin allowed',x.next===true&&x.res.headers['Access-Control-Allow-Origin']==='http://127.0.0.1:3000');
x=run(s.securityHeadersMiddleware(local),localReq);c('Security headers set',x.res.headers['X-Content-Type-Options']==='nosniff'&&x.res.headers['X-Frame-Options']==='DENY'&&String(x.res.headers['Content-Security-Policy']).includes("object-src 'none'"));
const buckets=new Map();const rl=s.rateLimitMiddleware({...local,limits:{apiPerMinute:30,mutationPerMinute:5,sensitivePerMinute:5}},{buckets,windowMs:60000,now:()=>1000});
let blocked=false;for(let i=0;i<6;i++){const r=run(rl,{method:'POST',path:'/api/bankroll/set',headers:{host:'127.0.0.1:3000'},socket:{remoteAddress:'127.0.0.1'}});if(r.res.statusCode===429)blocked=true;}c('Sensitive rate limit enforced',blocked===true);
c('Strict allowlist accepts code',s.allowlistedPath('backend/server.js')===true&&s.allowlistedPath('public/app.js')===true);
c('Strict allowlist rejects arbitrary root',s.allowlistedPath('secret.txt')===false&&s.allowlistedPath('../secret')===false);
const failed=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!failed.length,patch:'57',suite:'SECURITY_POLICY',checks:checks.length,details:checks},null,2));process.exit(failed.length?1:0);
