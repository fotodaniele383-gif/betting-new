#!/usr/bin/env node
'use strict';
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const i = process.argv.indexOf('--root');
const ROOT = i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..');
const target = path.join(ROOT, 'backend', 'calcioSportmonksXgProviderAudit16dR3R2.js');
const checks=[]; const failures=[];
function check(name, ok, details=null){ const row={name,ok:Boolean(ok),details}; checks.push(row); if(!row.ok) failures.push(row); }
(async()=>{
  const originalRequest = https.request;
  let captured = null;
  https.request = (opts, cb) => {
    captured = JSON.parse(JSON.stringify(opts));
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.resume = () => {};
      process.nextTick(() => {
        cb(res);
        process.nextTick(() => {
          res.emit('data', Buffer.from('{"data":[]}'));
          res.emit('end');
        });
      });
    };
    req.destroy = err => process.nextTick(() => req.emit('error', err));
    return req;
  };
  try {
    delete require.cache[require.resolve(target)];
    const provider = require(target);
    const token = 'R3_R2_R1_TEST_TOKEN_ONLY';
    await provider.requestJson('https://api.sportmonks.com/v3/football/leagues?per_page=1', { token, timeoutMs: 1000 });
    check('R3_R2_R1 revision exported', provider.AUDIT16D_R3_R2_R1_AUTH_REVISION === 'AUDIT16D_R3_R2_R1_RAW_AUTHORIZATION_HEADER_V1', provider.AUDIT16D_R3_R2_R1_AUTH_REVISION);
    check('Auth mode exported', provider.SPORTMONKS_AUTH_MODE === 'RAW_AUTHORIZATION_HEADER', provider.SPORTMONKS_AUTH_MODE);
    check('Authorization header uses raw token', captured?.headers?.Authorization === token, captured?.headers?.Authorization === token ? '[MATCH]' : '[MISMATCH]');
    check('Authorization header has no Bearer prefix', !String(captured?.headers?.Authorization||'').startsWith('Bearer '), '[REDACTED]');
    check('Token is not placed in URL path/query', !String(captured?.path||'').includes(token) && !String(captured?.path||'').includes('api_token='), captured?.path);
    check('Host fence preserved', captured?.hostname === 'api.sportmonks.com' && captured?.protocol === 'https:', {hostname:captured?.hostname,protocol:captured?.protocol});
    const health = provider.getProviderHealth({token});
    check('Health exposes raw auth mode without token', health.authMode === 'RAW_AUTHORIZATION_HEADER' && health.tokenConfigured === true && health.tokenExposed === false, health);
    check('No direct stake/gate authority', health.directStakeAuthority === false && health.directGateAuthority === false, health);
  } finally { https.request = originalRequest; }
  console.log(JSON.stringify({success:failures.length===0,patch:'AUDIT16D_R3_R2_R1',suite:'SPORTMONKS_RAW_AUTH_CONTRACT',checks:checks.length,failures,details:checks},null,2));
  process.exit(failures.length?1:0);
})().catch(e=>{ https.request=originalRequest; console.log(JSON.stringify({success:false,patch:'AUDIT16D_R3_R2_R1',suite:'SPORTMONKS_RAW_AUTH_CONTRACT',error:String(e?.stack||e)},null,2)); process.exit(1); });
