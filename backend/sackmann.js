'use strict';

// ============================================================================
// AI BETTING QUANT PRO - SACKMANN LOCAL EVIDENCE ADAPTER
// Versione 9.0 / Patch 14
// - caricamento locale sincrono: elimina la race dell'init async non awaited;
// - ogni query usa soltanto match precedenti alla data del pronostico;
// - nessuna rete nel percorso di analisi;
// - API legacy preservata per Quant Engine e DeepScan.
// ============================================================================

const path = require('path');
const playerEvidence = require('./tennisPlayerEvidence');

const SACKMANN_ADAPTER_VERSION = 'SACKMANN_LOCAL_REFRESHABLE_AS_OF_SAFE_V10_PATCH26';
const DEFAULT_DATA_DIR = path.join(__dirname, 'sackmann_data');
let activeDataDir = DEFAULT_DATA_DIR;
let initStatus = null;
let initError = null;

function init(baseDir = DEFAULT_DATA_DIR, options = {}) {
  activeDataDir = path.resolve(baseDir || DEFAULT_DATA_DIR);
  try {
    initStatus = playerEvidence.init(activeDataDir, options);
    initError = null;
    return { ...initStatus, adapterVersion: SACKMANN_ADAPTER_VERSION };
  } catch (error) {
    initError = error;
    initStatus = null;
    if (options.required === false) return { initialized: false, error: error.message, adapterVersion: SACKMANN_ADAPTER_VERSION };
    throw error;
  }
}

function ensureReady() {
  if (!initStatus) init(activeDataDir);
  return initStatus;
}

function getAdvancedMatchup(p1Name, p2Name, surface, dateStr, options = {}) {
  try {
    ensureReady();
    return playerEvidence.getLegacyCompatibleMatchup(p1Name, p2Name, surface, dateStr, { ...options, dataDir: activeDataDir });
  } catch (error) {
    initError = error;
    return { hasData: false, sourceStatus: 'ENGINE_ERROR', error: error.message, asOfSafe: true, evidenceVersion: playerEvidence.TENNIS_PLAYER_EVIDENCE_VERSION };
  }
}

function getPreScreenerData(p1Name, p2Name, surface, dateStr = new Date()) {
  try {
    ensureReady();
    return playerEvidence.getPreScreenerData(p1Name, p2Name, surface, dateStr, { dataDir: activeDataDir });
  } catch (error) {
    initError = error;
    return { p1SurfWr: 50, p2SurfWr: 50, p1H2hWins: 0, p2H2hWins: 0, evidenceStatus: 'ENGINE_ERROR', asOfSafe: true, error: error.message };
  }
}

function getEvidenceStatus() {
  const status = playerEvidence.getStatus();
  return {
    ...status,
    adapterVersion: SACKMANN_ADAPTER_VERSION,
    initialized: Boolean(status.initialized && !initError),
    initError: initError ? initError.message : null,
    networkUsed: false,
    refreshable: true,
    asOfSafe: true
  };
}

function buildMatchupEvidence(p1Name, p2Name, surface, dateStr, options = {}) {
  ensureReady();
  return playerEvidence.buildMatchupEvidence(p1Name, p2Name, surface, dateStr, { ...options, dataDir: activeDataDir });
}

module.exports = {
  SACKMANN_ADAPTER_VERSION,
  init,
  getAdvancedMatchup,
  getPreScreenerData,
  getEvidenceStatus,
  buildMatchupEvidence
};
