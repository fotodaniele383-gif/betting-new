#!/usr/bin/env node
'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
let checks=0;
function c(name,fn){fn();checks+=1;}
c('import module',()=>assert(server.includes("require('./tennisStakeExecutionContractPatch46')")));
c('schema startup',()=>assert(server.includes('tennisStakeExecutionContractPatch46.ensureSchema(db)')));
c('contract after calibration',()=>assert(server.indexOf('patch46StakeExecutionContract = tennisStakeExecutionContractPatch46.buildContract')>server.indexOf('const patch39FinalStake')));
c('fields persisted',()=>assert(server.includes('tennisStakeExecutionContractPatch46.toPersistenceFields')));
c('snapshot in transaction',()=>assert(server.includes('tennisStakeExecutionContractPatch46.persistSnapshot(db, patch46StakeExecutionContract)')));
c('API aligned',()=>assert(server.includes('finalExecutableStakeContract: patch46StakeExecutionContract')));
c('audit aligned',()=>assert(server.match(/finalExecutableStakeContract: patch46StakeExecutionContract/g).length>=2));
c('diagnostic structured',()=>assert(server.includes('cap rischio')&&server.includes('finale eseguibile')));
c('health exposes Patch46',()=>assert(server.includes('finalExecutableStakeContract:tennisStakeExecutionContractPatch46.health(db)')));
console.log(JSON.stringify({success:true,patch:'46',checks},null,2));
