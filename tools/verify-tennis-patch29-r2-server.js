'use strict';const fs=require('fs'),path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..'),paper=fs.readFileSync(path.join(root,'backend','paperTrading.tennis.js'),'utf8'),migration=fs.readFileSync(path.join(root,'backend','migrateTennisPatch29R2.js'),'utf8');const checks=[
['paper syntax',cp.spawnSync(process.execPath,['--check',path.join(root,'backend','paperTrading.tennis.js')]).status===0],
['migration syntax',cp.spawnSync(process.execPath,['--check',path.join(root,'backend','migrateTennisPatch29R2.js')]).status===0],
['engine R2',paper.includes('11.7_PATCH29_R2_SETTLEMENT_UPDATE_AUDIT_TRUTH')],
['manual review immutable',paper.includes('SETTLEMENT_MANUAL_REVIEW_PROTECTED')&&paper.includes('overrideProtectedManualReview')],
['fingerprint runtime',paper.includes('PATCH29_R2_MANUAL_REVIEW_PERSIST_FAILED')],
['DB fail only actual',paper.includes('diagnostics.dbUpdateFailures++')&&paper.includes('lifecycleAtomicFailure')],
['attempt audit',paper.includes('settlementAttemptAudit.push')],
['post counts',paper.includes('diagnostics.pendingAfter = pendingAfterRows.length')],
['repair migration',migration.includes('APPLY_PROTECTED_MANUAL_REVIEW_REPAIR')]
].map(([name,ok])=>({name,ok}));const bad=checks.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks,failed:bad.length},null,2));process.exit(bad.length?1:0);
