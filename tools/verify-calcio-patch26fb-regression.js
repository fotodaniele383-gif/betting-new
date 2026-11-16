'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.join(__dirname,'..'); const hashes={
 'backend/calcioQuantEngine.js':'925dc8e1020c3eae07a33fe02d6dfd802656e8c07addba419ad7ffd0a4d4af27',
 'backend/calcioUnifiedStakeAuthority.js':'ec17b09a05df58a48a1c42467e003eeae590ba71739785f9189cc1a202f83529',
 'backend/calcioBatchPortfolioAllocator.js':'d8447cd69d5e769d45d84ffbc65189a51fa1bef4659b1c11f17b4fd559a8b687',
 'backend/calcioFinalMarketDiagnosticContract.js':'739ee26bd749be1cfa50311e18adec4ed221ff5eadbe263381399547196bee05',
 'backend/server.tennis.js':'9d25211819be2d9ee7b0f427214b9a4f6a8ad5733da66dd21751ccf7436e8b11'
};
const results=[]; for(const [file,expected] of Object.entries(hashes)){const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'); const ok=actual===expected; assert.ok(ok,`${file} changed`); results.push({file,ok,sha256:actual});}
const registry=require('../backend/calcioPatchRegistry'); assert.strictEqual(registry.CALCIO_CURRENT_PATCH_VERSION,'34'); assert.strictEqual(registry.PATCHES.at(-1).id,'BETTING_PATCH_26F_B_CALCIO_HISTORICAL_COVERAGE_ENTITY_RESOLUTION');
results.push({file:'backend/calcioPatchRegistry.js',ok:true,registry:'34'});
console.log(JSON.stringify({success:true,protectedAuthorities:{productionProbability:true,unifiedStakeAuthority:true,portfolioCaps:true,finalMarketContract:true,tennis:true},results},null,2));
