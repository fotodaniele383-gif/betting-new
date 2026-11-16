'use strict';

const VERSION = 'TENNIS_DEEPSCAN_CANONICAL_TAXONOMY_V1_PATCH40';

const CATEGORIES = Object.freeze({
  MODEL_RISK: Object.freeze({ code: 'MODEL_RISK', label: 'RISCHIO MODELLO', icon: '🟠', order: 10 }),
  TECHNICAL_EDGE: Object.freeze({ code: 'TECHNICAL_EDGE', label: 'EDGE TECNICO', icon: '📊', order: 20 }),
  VALUE_CONFIRMED_MICRO: Object.freeze({ code: 'VALUE_CONFIRMED_MICRO', label: 'VALUE CONFERMATO / MICRO', icon: '🟢', order: 30 }),
  HIGH_RISK: Object.freeze({ code: 'HIGH_RISK', label: 'ALTO RISCHIO', icon: '🔴', order: 40 }),
  WATCHLIST_LOW_EDGE: Object.freeze({ code: 'WATCHLIST_LOW_EDGE', label: 'WATCHLIST LOW EDGE', icon: '🟡', order: 50 }),
  WAIT_IN_PLAY: Object.freeze({ code: 'WAIT_IN_PLAY', label: 'ATTENDI IN-PLAY', icon: '⏳', order: 60 }),
  NO_DEEPSCAN: Object.freeze({ code: 'NO_DEEPSCAN', label: 'SENZA DEEPSCAN', icon: '⚪', order: 70 }),
  OTHER: Object.freeze({ code: 'OTHER', label: 'ALTRO / NON CLASSIFICATO', icon: '⚪', order: 80 })
});

function clean(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[🟠📊🟢🔴🟡⏳⚪]/g, ' ')
    .replace(/[·]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function inputText(input) {
  if (typeof input === 'string') return clean(input);
  const row = input || {};
  return [
    row.deep_scan_canonical_code,
    row.deep_scan_canonical_label,
    row.ds_action,
    row.deepScanAction,
    row.action,
    row.deep_scan_risk_level,
    row.quality_deepscan_class,
    row.deepscan_gate_status,
    row.ds_suggestion,
    row.suggestionText,
    row.mode
  ].map(clean).filter(Boolean).join(' | ');
}

function result(category, rawText) {
  return Object.freeze({
    version: VERSION,
    code: category.code,
    label: category.label,
    icon: category.icon,
    displayLabel: `${category.icon} ${category.label}`,
    rawText: rawText || '',
    authority: 'CANONICAL_DISPLAY_AND_GROUPING_ONLY'
  });
}

function normalize(input) {
  const text = inputText(input);
  if (!text) return result(CATEGORIES.NO_DEEPSCAN, text);

  if (/ALTO RISCHIO|HIGH RISK|VALUE TRAP|PERICOLO|DEEPSCAN HIGH RISK/.test(text)) return result(CATEGORIES.HIGH_RISK, text);
  if (/RISCHIO MODELLO|MODEL RISK|RISCHIO MODELLO TOTALS/.test(text)) return result(CATEGORIES.MODEL_RISK, text);
  if (/VALUE CONFERMATO|VALUE CONFIRMED|CONFIRMED VALUE|VIA LIBERA|LOW MEDIUM/.test(text)) return result(CATEGORIES.VALUE_CONFIRMED_MICRO, text);
  if (/EDGE TECNICO|TECHNICAL EDGE/.test(text)) return result(CATEGORIES.TECHNICAL_EDGE, text);
  if (/WATCHLIST|LOW EDGE/.test(text)) return result(CATEGORIES.WATCHLIST_LOW_EDGE, text);
  if (/ATTENDI|WAIT IN PLAY|IN PLAY|LIVE/.test(text)) return result(CATEGORIES.WAIT_IN_PLAY, text);
  return result(CATEGORIES.OTHER, text);
}

function decorateRow(row = {}) {
  const canonical = normalize(row);
  return {
    ...row,
    deep_scan_taxonomy_version: VERSION,
    deep_scan_canonical_code: canonical.code,
    deep_scan_canonical_label: canonical.label,
    deep_scan_canonical_icon: canonical.icon,
    deep_scan_canonical_display: canonical.displayLabel
  };
}

function registry() {
  return Object.values(CATEGORIES)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(item => ({ ...item }));
}

module.exports = { VERSION, CATEGORIES, clean, normalize, decorateRow, registry };
