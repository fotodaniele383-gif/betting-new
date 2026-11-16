#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const security = require('../backend/productionSecuritySafeReleasePatch57');

const root = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check-only');
const config = security.resolveRuntimeConfig({ projectRoot: root });
function fail(code, message) {
  if (!checkOnly) console.error(JSON.stringify({ success:false, code, message, securityVersion:security.VERSION }, null, 2));
  process.exit(2);
}
if (!config.remoteAccessEnabled) fail('PATCH57_REMOTE_ACCESS_DISABLED', 'Imposta BETTINGAPP_REMOTE_ACCESS_ENABLED=1 per avviare il tunnel.');
if (!config.remoteTokenConfigured) fail('PATCH57_REMOTE_TOKEN_REQUIRED', `BETTINGAPP_REMOTE_ACCESS_TOKEN deve contenere almeno ${security.MIN_REMOTE_TOKEN_LENGTH} caratteri non-placeholder.`);
if (!config.loopbackBind) fail('PATCH57_REMOTE_TUNNEL_REQUIRES_LOOPBACK_BIND', 'Il tunnel sicuro Patch57 richiede BETTINGAPP_BIND_HOST=127.0.0.1.');
if (!config.ready) fail('PATCH57_RUNTIME_SECURITY_NOT_READY', config.status);
if (checkOnly) process.exit(0);

const exe = process.platform === 'win32' && fs.existsSync(path.join(root, 'backend', 'ngrok.exe')) ? path.join(root, 'backend', 'ngrok.exe') : 'ngrok';
const args = ['http'];
const domain = String(process.env.BETTINGAPP_NGROK_DOMAIN || '').trim();
if (domain) args.push(`--domain=${domain}`);
args.push(String(config.port));
console.log(JSON.stringify({
  success:true,
  securityVersion:security.VERSION,
  mode:'SECURE_REMOTE_TOKEN_GATED',
  bindHost:config.bindHost,
  port:config.port,
  remoteTokenConfigured:true,
  tokenExposed:false,
  domainConfigured:Boolean(domain)
}, null, 2));
const child = cp.spawn(exe, args, { cwd:path.join(root,'backend'), stdio:'inherit', windowsHide:false });
child.on('error', error => { console.error(`PATCH57_NGROK_START_FAILED:${error.message}`); process.exitCode=1; });
child.on('exit', code => { process.exitCode = Number(code || 0); });
