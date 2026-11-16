'use strict';const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),read=r=>fs.readFileSync(path.join(root,r),'utf8');
const resolver=read('backend/tennisOfficialSettlementResolver.js'),migration=read('backend/migrateTennisPatch29R1.js'),forward=read('backend/tennisForwardCaptureHealth.js'),server=read('backend/server.tennis.js'),prog=read('backend/tennisProgramProgressionAudit.js');
const checks=[
['resolver V2',resolver.includes('TENNIS_OFFICIAL_SETTLEMENT_RESOLVER_V2_PATCH29_R1')],
['WTA official draws URL',resolver.includes('/washington-dc/2026/draws')],
['WTA parser',resolver.includes('parseWtaOfficialDrawText')],
['signed WTA seed',resolver.includes('tennisOfficialSettlementSeedPatch29R1.json')],
['signed retirement evidence',resolver.includes('tennisOfficialRetirementEvidencePatch29R1.json')],
['cache in-flight dedupe',resolver.includes('pageInFlight')&&resolver.includes('fetchTextCached')],
['no Odds endpoint',!resolver.includes('api.the-odds-api.com')],
['future guard',migration.includes('FUTURE_MATCH')],
['fingerprint guard',migration.includes('identityManualReview')&&migration.includes('OFFICIAL_EVENT_MARKET_FINGERPRINT_MISMATCH')],
['retirement manual guard',migration.includes('retirementManualReview')&&migration.includes('automaticSettlement: false')],
['no schema migration',!migration.includes('ALTER TABLE')&&!migration.includes('CREATE TABLE')],
['CLV immutable',migration.includes('clvFieldsUnchanged')],
['forward performance refresh',migration.includes('refreshForwardPerformance')],
['capture policy V3',forward.includes('TENNIS_FORWARD_CAPTURE_DIAGNOSTIC_POLICY_V3_PATCH29_R1')],
['capture no false evidence overdue on manual',forward.includes('SETTLEMENT_IDENTITY_REVIEW_REQUIRED')&&forward.includes('SETTLEMENT_BOOKMAKER_RULE_REQUIRED')],
['server event separation',server.includes('FORWARD_SETTLEMENT_IDENTITY_REVIEW_REQUIRED')&&server.includes('FORWARD_SETTLEMENT_BOOKMAKER_RULE_REQUIRED')],
['progression V19',prog.includes('TENNIS_PROGRAM_PROGRESSION_AUDIT_V19_PATCH29_R1')]
];const results=checks.map(([name,ok])=>({name,ok:Boolean(ok)})),bad=results.filter(x=>!x.ok);console.log(JSON.stringify({success:!bad.length,checks:results.length,results},null,2));process.exit(bad.length?1:0);
