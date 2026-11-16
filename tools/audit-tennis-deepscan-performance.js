#!/usr/bin/env node
'use strict';
const deep=require('../backend/deepScanTennis');console.log(JSON.stringify({success:true,readOnly:true,patch:'TENNIS_PATCH_27',queue:{legacyPacingMs:4000,tennisPacingMs:150,savedMsFor14Events:50050},performance:deep.getPatch27PerformanceHealth(),note:'Le cache RAM sono limitate e process-local; al riavvio vengono ricostruite da cache disco e fonti.'},null,2));
