#!/usr/bin/env node
'use strict';
const path=require('path');const mod=require('../backend/tennisExternalMatchIntelligencePatch37');
function arg(name,fallback=null){const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:fallback;}
const input={p1Name:arg('p1'),p2Name:arg('p2'),prediction:arg('prediction','1'),tour:arg('tour'),surface:arg('surface'),context:{tournament:arg('tournament'),league:arg('league'),surface:arg('surface'),match_date:arg('match-date')}};
if(!input.p1Name||!input.p2Name){console.error('Uso: node tools/probe-tennis-external-intelligence.js --p1 "Player A" --p2 "Player B" --tour ATP --surface Hard --tournament "US Open" --match-date 2026-08-30T18:00:00Z [--offline]');process.exit(2);}
mod.buildExternalMatchIntelligence(input,{dataDir:path.resolve('backend/sackmann_data'),skipNetwork:process.argv.includes('--offline')}).then(result=>console.log(JSON.stringify({success:true,result},null,2))).catch(error=>{console.log(JSON.stringify({success:false,error:error.message},null,2));process.exit(1);});
