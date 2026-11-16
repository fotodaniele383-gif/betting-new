'use strict';
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');
const files=['backend/server.tennis.js','backend/tennisForwardCohorts.js','backend/tennisForwardCaptureHealth.js','backend/tennisPendingEventRevisionSafety.js','backend/tennisProgramProgressionAudit.js','backend/paperTrading.tennis.js'];
const missing=files.filter(f=>!fs.existsSync(path.join(root,f)));const server=fs.readFileSync(path.join(root,'backend/server.tennis.js'),'utf8');
const checks={missing,revisionSafetyImported:server.includes("require('./tennisPendingEventRevisionSafety')"),progressionV15:server.includes('V15_PATCH28'),evidenceStatusExposed:server.includes('evidenceStatus: result?.diagnostics?.evidenceStatus')};
const success=!missing.length&&Object.values(checks).slice(1).every(Boolean);console.log(JSON.stringify({success,checks},null,2));process.exit(success?0:1);
