#!/usr/bin/env node
'use strict';
const s=require('../backend/quantv2OpenSources');
if(process.argv.length!==3){console.error('Uso: node tools/quantv2_import_tennis_ratings.cjs <ratings.json>');process.exitCode=2;}
else try{console.log(JSON.stringify(s.importLocal('baseline_tennis_ratings',process.argv[2]),null,2))}catch(e){console.error(e.message);process.exitCode=2}
