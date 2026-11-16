#!/usr/bin/env node
'use strict';
const path = require('path');
const legacySecurity = require('../backend/tennisReleaseSecurity');
let patch57 = null;
try { patch57 = require('../backend/productionSecuritySafeReleasePatch57'); } catch (_) {}
const idx = process.argv.indexOf('--root');
const rootArgEq = process.argv.find(arg => arg.startsWith('--root='));
const root = path.resolve(idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : rootArgEq ? rootArgEq.slice(7) : path.join(__dirname, '..'));
const health = patch57
  ? patch57.buildProductionSecurityHealth({ projectRoot: root })
  : legacySecurity.buildSecurityHealth({ projectRoot: root });
console.log(JSON.stringify(health, null, 2));
if (!(health.healthy || health.securityReady)) process.exitCode = 1;
