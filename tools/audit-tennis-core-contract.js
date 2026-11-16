#!/usr/bin/env node
'use strict';
const path = require('path');
const audit = require('../backend/tennisCoreContractAudit');
const rootIndex = process.argv.indexOf('--root');
const projectRoot = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : path.join(__dirname, '..'));
const report = audit.buildCoreContractAudit({ projectRoot });
console.log(JSON.stringify(report, null, 2));
process.exit(report.healthy ? 0 : 1);
