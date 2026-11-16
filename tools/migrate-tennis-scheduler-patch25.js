'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || process.cwd());
const file = path.join(root, 'backend', 'tennis_cron_config.json');
const now = new Date();
function iso(value) { const d = value ? new Date(value) : null; return d && Number.isFinite(d.getTime()) ? d.toISOString() : null; }
function hours(value) { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.max(1, Math.min(24, n)) : 1; }
function days(value) { return Array.isArray(value) ? [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a,b)=>a-b) : []; }
function allowed(timestamp, selected) { return !selected.length || selected.includes(new Date(timestamp).getDay()); }
function nextRun(config, nowMs) {
  const interval = hours(config.intervalHours) * 3600000;
  let candidate = iso(config.nextRunAt) ? new Date(config.nextRunAt).getTime() : null;
  const anchor = iso(config.intervalAnchorAt) || iso(config.lastRunAt) || now.toISOString();
  if (!candidate) candidate = new Date(anchor).getTime() + interval;
  if (candidate <= nowMs) candidate += (Math.floor((nowMs - candidate) / interval) + 1) * interval;
  const selected = days(config.days);
  let guard = 0;
  while (!allowed(candidate, selected) && guard++ < 200) candidate += interval;
  if (guard >= 200) throw new Error('PATCH25_ALLOWED_DAY_NOT_FOUND');
  return new Date(candidate).toISOString();
}
if (!fs.existsSync(file)) throw new Error(`CONFIG_MISSING:${file}`);
const before = JSON.parse(fs.readFileSync(file, 'utf8'));
const intervalHours = hours(before.intervalHours);
const selectedDays = days(before.days);
const after = {
  ...before,
  intervalHours,
  days: selectedDays,
  schedulerMode: before.type === 'interval_hours' ? 'PERSISTENT_EXACT_INTERVAL' : 'CRON_COMPATIBILITY',
  intervalAnchorAt: iso(before.intervalAnchorAt) || now.toISOString(),
  nextRunAt: before.type === 'interval_hours' ? nextRun(before, now.getTime()) : null,
  scheduleSummary: before.type === 'interval_hours'
    ? `Ogni ${intervalHours} ore reali · ${selectedDays.length ? selectedDays.map(d => ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'][d]).join(', ') : 'tutti i giorni'} · ${before.updateMode === 'paper_trading' ? 'solo paper trading' : before.updateMode === 'analysis_ai' ? 'solo Analisi AI' : 'tutto'}`
    : before.scheduleSummary,
  patch25MigrationVersion: 'TENNIS_SCHEDULER_STATE_MIGRATION_V1_PATCH25'
};
const tmp = `${file}.patch25.tmp`;
fs.writeFileSync(tmp, JSON.stringify(after, null, 2), 'utf8');
fs.renameSync(tmp, file);
console.log(JSON.stringify({ success: true, patch: '25', file, before: { type: before.type, intervalHours: before.intervalHours, nextRunAt: before.nextRunAt || null }, after: { type: after.type, intervalHours: after.intervalHours, schedulerMode: after.schedulerMode, intervalAnchorAt: after.intervalAnchorAt, nextRunAt: after.nextRunAt, scheduleSummary: after.scheduleSummary } }, null, 2));
