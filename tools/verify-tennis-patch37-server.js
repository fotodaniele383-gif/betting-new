#!/usr/bin/env node
'use strict';
const fs=require('fs');const assert=require('assert');const server=fs.readFileSync('backend/server.tennis.js','utf8');const deep=fs.readFileSync('backend/deepScanTennis.js','utf8');
const checks=[];function ck(name,value){checks.push({name,ok:Boolean(value)});assert(value,name);}
ck('server import',server.includes("require('./tennisExternalMatchIntelligencePatch37')"));
ck('health endpoint',server.includes("router.get('/external-match-intelligence-health'"));
ck('probe endpoint',server.includes("router.get('/external-match-intelligence-probe'"));
ck('receipt persistence',server.includes('persistReceipt(db, updatedPending || existingPending, patch37External)'));
ck('deep scan integration',deep.includes('PATCH37_EXTERNAL_MATCH_INTELLIGENCE'));
ck('structured h2h engine',deep.includes('PATCH37_H2H_TRUTH'));
ck('old extreme h2h removed',!deep.includes('Bestia Nera')&&!deep.includes('Win Rate pompato'));
ck('weather confidence only',deep.includes('externalConfidencePenalty'));
ck('output receipt',deep.includes('externalMatchIntelligence: externalIntelligence'));
console.log(JSON.stringify({success:true,checks},null,2));
