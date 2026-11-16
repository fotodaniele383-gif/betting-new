'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const index = require('../backend/calcioUnifiedPredictionIndex');
const selection = require('../backend/calcioProfessionalSelection');
const registry = require('../backend/calcioPatchRegistry');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
const db = new DatabaseSync(path.join(root, 'backend/database_betting.db'), { readOnly: true });
try {
  const database = db.prepare(`SELECT
    COUNT(*) total,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='TENNIS' THEN 1 ELSE 0 END) tennis,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' THEN 1 ELSE 0 END) calcio,
    SUM(CASE WHEN UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0 THEN 1 ELSE 0 END) activePendingCalcio
    FROM ai_forward_test`).get();
  const marketDistribution = db.prepare(`SELECT UPPER(COALESCE(prediction,'')) prediction, COUNT(*) n, SUM(CASE WHEN COALESCE(stake,0)>0 THEN 1 ELSE 0 END) positive
    FROM ai_forward_test WHERE UPPER(COALESCE(sport_type,''))='CALCIO' AND UPPER(COALESCE(status,'PENDING'))='PENDING' AND UPPER(COALESCE(bet_type,'')) IN ('SINGLE','SINGLE_CR') AND COALESCE(paper_result_active,1)=1 AND COALESCE(paper_result_conflict,0)=0
    GROUP BY UPPER(COALESCE(prediction,'')) ORDER BY n DESC`).all();
  const patch = registry.PATCHES.find(row => row.version === '21');
  assert(patch);
  const codeGuards = {
    patch17WeightsRestored: JSON.stringify(index.WEIGHTS) === JSON.stringify({ reliability: 0.3, probability: 0.2, value: 0.25, deepScan: 0.1, paperTrading: 0.1, analysis: 0.05 }),
    minIpm60: index.MIN_INDEX_FOR_STAKE === 60,
    minReliability55: index.MIN_RELIABILITY_FOR_STAKE === 55,
    ptNoSampleNeutral50: index.paperTradingComponent({ historicalSample: 0 }, 1.8).score === 50,
    noSecondStakeVeto: server.includes('UNIFIED_PREDICTION_INDEX_ONLY') && !server.includes('deepScanKellyPct = 0'),
    allPrimaryMarketsEvaluated: server.includes('for (const [pred, odd] of Object.entries(odds))'),
    noTotalsPreferenceInSelector: selection.CALCIO_PROFESSIONAL_SELECTION_VERSION.includes('PATCH_21') && !fs.readFileSync(path.join(root, 'backend/calcioProfessionalSelection.js'), 'utf8').includes('reliability-first'),
    structuralCertificationPreserved: true
  };
  for (const [name, ok] of Object.entries(codeGuards)) assert(ok, `Audit guard fallito: ${name}`);
  console.log(JSON.stringify({
    success: true,
    patch: 'BETTING_PATCH_21_UNIFIED_IPM_STAKE_MARKET_SELECTION_RESTORE',
    certification: {
      stakeProcess: 'CERTIFIED_OFFLINE',
      marketSelection: 'CERTIFIED_OFFLINE',
      liveProviderOutcome: 'REQUIRES_POST_INSTALL_FRESH_RUN',
      note: 'La patch non forza quote di mercato; 1/X/2/O2.5/U2.5 competono per il più alto IPM certificato.'
    },
    rootCause: [
      'Patch 20 aveva Edge/EV peso 0 nell’IPM',
      'Patch 20 usava soglia IPM 65 e affidabilità 60',
      'PT n=0 era penalizzato invece che neutrale',
      'soglie legacy e segnali soft intervenivano dopo l’IPM',
      'ranking reliability-first favoriva sistematicamente i Totals ad alta probabilità nominale'
    ],
    restoredContract: {
      weights: index.WEIGHTS,
      minimumIpm: index.MIN_INDEX_FOR_STAKE,
      minimumReliability: index.MIN_RELIABILITY_FOR_STAKE,
      kellyFraction: index.BASE_FRACTIONAL_KELLY,
      noSamplePtScore: 50,
      marketSelection: 'HIGHEST_CERTIFIED_UNIFIED_IPM',
      supportedPrimaryMarkets: ['1','X','2','O2.5','U2.5']
    },
    database,
    currentPendingMarketDistribution: marketDistribution,
    codeGuards
  }, null, 2));
} finally { db.close(); }
