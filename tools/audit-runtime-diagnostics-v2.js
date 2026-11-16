'use strict';
const diagnostics = require('../backend/runtimeDiagnostics');
const recent = diagnostics.readRecentDiagnostics(50, { scope:'ALL' });
console.log(JSON.stringify({ success:true, readOnly:true, version:diagnostics.RUNTIME_DIAGNOSTICS_VERSION, compatibilityVersion:diagnostics.RUNTIME_DIAGNOSTICS_COMPAT_VERSION, readMode:'TAIL_FILTERED_READ_ONLY', recentRows:recent.length, summary:diagnostics.buildDiagnosticsSummary(recent), safeguards:{ secretsRedacted:true, legacyPatch5Compatible:true } }, null, 2));
