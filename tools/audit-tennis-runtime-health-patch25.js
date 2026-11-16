'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const dbPath = process.env.BETTING_DB_PATH || path.join(root, 'backend', 'database_betting.db');
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry.js'));
const contract = require(path.join(root, 'backend', 'tennisRuntimeHealthContract.js'));
const scheduler = require(path.join(root, 'backend', 'tennisAutoScheduler.js'));
const intake = require(path.join(root, 'backend', 'tennisForwardSampleIntake.js'));
const progression = require(path.join(root, 'backend', 'tennisProgramProgressionAudit.js'));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const sourceBefore = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const integrity = db.pragma('integrity_check', { simple: true });
  const versions = contract.buildRuntimeVersions(registry.getTennisPatchStatus());
  const forward = intake.inspectForwardSampleIntake(db);
  const progressionReport = progression.buildProgramProgressionAudit(db, { projectRoot: root });
  const schedulerStatus = scheduler.getSchedulerStatus();
  const operational = progressionReport.operationalSummary || contract.buildOperationalReadiness({ healthStatus: progressionReport.status, forwardIntake: forward });
  const sourceAfter = Number(db.prepare('SELECT COUNT(*) n FROM ai_forward_test').get().n || 0);
  const report = {
    success: integrity === 'ok' && sourceBefore === sourceAfter && progressionReport.errors === 0 && forward.structuralReady === true && schedulerStatus.schedulerMode === 'PERSISTENT_EXACT_INTERVAL' && schedulerStatus.legacyMisleadingCronBlocked === true,
    patch: '25',
    version: contract.TENNIS_RUNTIME_HEALTH_CONTRACT_VERSION,
    readOnly: true,
    integrity,
    databaseRowsModified: sourceAfter - sourceBefore,
    runtimeVersions: versions,
    operationalReadiness: operational,
    scheduler: {
      version: schedulerStatus.schedulerVersion,
      mode: schedulerStatus.schedulerMode,
      intervalHours: schedulerStatus.intervalHours,
      nextRunAt: schedulerStatus.nextRunAt,
      scheduleSummary: schedulerStatus.scheduleSummary,
      legacyMisleadingCronBlocked: schedulerStatus.legacyMisleadingCronBlocked,
      singleFlightLockActive: schedulerStatus.singleFlightLockActive
    },
    firstMatch: {
      structuralReady: forward.structuralReady,
      status: forward.status,
      nextAction: forward.nextAction,
      missingTables: forward.missingTables,
      structuralGaps: forward.structuralGaps,
      actionableRows: forward.forwardSample?.actionableRows || 0,
      historicalBackfill: forward.historicalBackfill,
      authority: forward.authority
    },
    progression: { status: progressionReport.status, errors: progressionReport.errors, warnings: progressionReport.warnings, version: progressionReport.version }
  };
  const outDir = path.join(root, 'audit_patch25'); fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'patch25_runtime_health_audit.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'patch25_runtime_health_audit.md'), [
    '# Patch 25 — Runtime Health & Exact Scheduler Audit','',
    `- Successo: **${report.success}**`, `- Stato operativo: **${operational.state}**`,
    `- Patch: **${versions.currentPatchVersion}**`, `- Server Core: **${versions.serverCoreVersion}**`, `- Tennis Engine: **${versions.tennisEngineVersion}**`,
    `- Scheduler: **${schedulerStatus.schedulerMode}**, prossimo ${schedulerStatus.nextRunAt || 'N/D'}`,
    `- Primo match: **${forward.status}**, struttura ${forward.structuralReady ? 'PRONTA' : 'NON PRONTA'}`,
    `- SQLite: **${integrity}**, righe modificate ${report.databaseRowsModified}`
  ].join('\n'));
  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exit(2);
} finally { db.close(); }
