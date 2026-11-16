'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'audit_out');
const DB_PATH = process.env.BETTING_DB_PATH || path.join(ROOT, 'backend', 'database_betting.db');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function safeQuery(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    return [{ error: error.message, sql }];
  }
}

function tableToMarkdown(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '_Nessun dato._';
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = v => String(v ?? '').replace(/\|/g, '\\|');
  return [
    `| ${keys.join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${keys.map(k => esc(r[k])).join(' | ')} |`)
  ].join('\n');
}

function analyzeSource() {
  const server = readText('backend/server.js');
  const tennis = readText('backend/server.tennis.js');
  const tennisValue = readText('backend/tennisValueEvaluator.js');
  const app = readText('public/app.js') || readText('backend/public/app.js');

  const checks = [
    {
      id: 'db_path_absolute_or_env',
      status: /BETTING_DB_PATH\s*\|\|\s*path\.resolve/.test(server) && /BETTING_DB_PATH\s*\|\|\s*path\.resolve/.test(tennis) ? 'PASS' : 'WARN',
      detail: 'DB path configurabile via BETTING_DB_PATH e risolto in assoluto.'
    },
    {
      id: 'tennis_strict_history',
      status: /UPPER\(COALESCE\(data_quality/.test(tennis) && /CURRENT_BOOTSTRAP/.test(tennis) && /UPPER\(COALESCE\(sport_type/.test(tennis) ? 'PASS' : 'FAIL',
      detail: 'Query Tennis filtrate su sport_type TENNIS e data_quality CURRENT/CURRENT_BOOTSTRAP.'
    },
    {
      id: 'calcio_strict_history',
      status: /DATA_QUALITY_LEGACY_DIRTY/.test(server) && /UPPER\(COALESCE\(sport_type/.test(server) ? 'PASS' : 'WARN',
      detail: 'Calcio esclude legacy dirty e separa Tennis nei punti principali.'
    },
    {
      id: 'totals_no_directional_bias',
      status: /(probOverPct\s*\*=\s*0\.(65|85)|probUnderPct\s*\*=\s*1\.(15|35))/.test(tennis) ? 'FAIL' : 'PASS',
      detail: 'Controllo specifico bug: nessun moltiplicatore fisso che spinga Over/Under.'
    },
    {
      id: 'totals_probability_cap',
      status: /TENNIS_TOTALS_MAX_CALIBRATED_PROB/.test(tennis) && /balanceTennisTotalsProbabilities/.test(tennis) ? 'PASS' : 'WARN',
      detail: 'Totals normalizzati con shrink verso 50/50 e cap anti-probabilità estreme.'
    },
    {
      id: 'market_mix_response',
      status: /marketMixAudit/.test(tennis) && /renderAnalysisMarketMixNotice/.test(app) ? 'PASS' : 'WARN',
      detail: 'Risposta live e UI mostrano quanti Moneyline / Over / Under sono stati prodotti.'
    },
    {
      id: 'professional_totals_gate',
      status: /BLOCKED_MARKOV_TOTALS/.test(tennisValue) && /markovValidated/.test(tennisValue) ? 'PASS' : 'WARN',
      detail: 'Totals richiedono Markov validato nel gate professionale.'
    },
    {
      id: 'ui_expand_reduce',
      status: /toggleSeniorAuditFullscreen/.test(app) && /toggleSeniorAuditCompact/.test(app) ? 'PASS' : 'WARN',
      detail: 'Index/analisi e portafoglio hanno controlli riduci/schermo intero.'
    }
  ];

  return checks;
}

function analyzeDb() {
  if (!fs.existsSync(DB_PATH)) {
    return { dbPath: DB_PATH, error: 'database_betting.db non trovato' };
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    return { dbPath: DB_PATH, error: `better-sqlite3 non disponibile: ${error.message}` };
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (error) {
    return { dbPath: DB_PATH, error: `database non apribile con better-sqlite3: ${error.message}` };
  }

  const out = {
    dbPath: DB_PATH,
    totalRows: safeQuery(db, 'SELECT COUNT(*) AS count FROM ai_forward_test')[0]?.count ?? 0,
    bySportQualityStatus: safeQuery(db, `
      SELECT COALESCE(sport_type, 'NULL') AS sport_type,
             COALESCE(data_quality, 'NULL') AS data_quality,
             COALESCE(status, 'NULL') AS status,
             COUNT(*) AS count
      FROM ai_forward_test
      GROUP BY sport_type, data_quality, status
      ORDER BY count DESC
    `),
    cleanCurrentSettledBySport: safeQuery(db, `
      SELECT sport_type, status, COUNT(*) AS count,
             ROUND(AVG(estimated_prob), 2) AS avg_estimated_prob,
             ROUND(AVG(odd), 2) AS avg_odd,
             ROUND(SUM(COALESCE(profit, 0)), 2) AS profit
      FROM ai_forward_test
      WHERE status IN ('WON','LOST')
        AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT','CURRENT_BOOTSTRAP')
        AND UPPER(COALESCE(sport_type, '')) IN ('CALCIO','FOOTBALL','SOCCER','TENNIS')
      GROUP BY sport_type, status
      ORDER BY sport_type, status
    `),
    currentTennisMarketMix: safeQuery(db, `
      SELECT CASE
               WHEN UPPER(COALESCE(prediction, '')) LIKE 'OVER%' THEN 'OVER'
               WHEN UPPER(COALESCE(prediction, '')) LIKE 'UNDER%' THEN 'UNDER'
               WHEN UPPER(COALESCE(prediction, '')) IN ('1','2','P1','P2') THEN 'MONEYLINE'
               ELSE 'OTHER'
             END AS market_bucket,
             status,
             COUNT(*) AS count,
             ROUND(AVG(edge_pp), 2) AS avg_edge_pp,
             ROUND(AVG(ev_pct), 2) AS avg_ev_pct,
             ROUND(AVG(estimated_prob), 2) AS avg_estimated_prob
      FROM ai_forward_test
      WHERE UPPER(COALESCE(sport_type, '')) = 'TENNIS'
        AND UPPER(COALESCE(data_quality, '')) IN ('CURRENT','CURRENT_BOOTSTRAP')
      GROUP BY market_bucket, status
      ORDER BY count DESC
    `),
    totalsLineHistory: safeQuery(db, `
      SELECT prediction,
             COALESCE(point_line, '') AS point_line,
             status,
             COUNT(*) AS count,
             ROUND(AVG(estimated_prob), 2) AS avg_estimated_prob,
             ROUND(AVG(odd), 2) AS avg_odd,
             ROUND(SUM(COALESCE(profit, 0)), 2) AS profit
      FROM ai_forward_test
      WHERE UPPER(COALESCE(prediction, '')) LIKE 'OVER%'
         OR UPPER(COALESCE(prediction, '')) LIKE 'UNDER%'
      GROUP BY prediction, point_line, status
      ORDER BY prediction, status
    `),
    possibleContamination: safeQuery(db, `
      SELECT id, bet_type, sport_type, data_quality, prediction, status, home_team, away_team
      FROM ai_forward_test
      WHERE (sport_type IS NULL OR TRIM(COALESCE(sport_type, '')) = '')
        AND (
          UPPER(COALESCE(bet_type, '')) LIKE '%TENNIS%'
          OR UPPER(COALESCE(prediction, '')) LIKE 'OVER% GAME%'
          OR UPPER(COALESCE(prediction, '')) LIKE 'UNDER% GAME%'
        )
      ORDER BY id DESC
      LIMIT 40
    `)
  };

  db.close();
  return out;
}

function buildMarkdown(sourceChecks, dbAudit) {
  const pass = sourceChecks.filter(c => c.status === 'PASS').length;
  const warn = sourceChecks.filter(c => c.status === 'WARN').length;
  const fail = sourceChecks.filter(c => c.status === 'FAIL').length;

  return `# Senior Audit BettingApp\n\n` +
    `Generato: ${new Date().toISOString()}\n\n` +
    `## Esito sintetico\n\n` +
    `- Source checks: ${pass} PASS, ${warn} WARN, ${fail} FAIL.\n` +
    `- DB analizzato: \`${dbAudit.dbPath || DB_PATH}\`.\n` +
    `- Righe ai_forward_test: ${dbAudit.totalRows ?? 'N/D'}.\n\n` +
    `## Check sorgenti\n\n${tableToMarkdown(sourceChecks)}\n\n` +
    `## DB: sport / data_quality / status\n\n${tableToMarkdown(dbAudit.bySportQualityStatus || [])}\n\n` +
    `## DB: settled clean/current per sport\n\n${tableToMarkdown(dbAudit.cleanCurrentSettledBySport || [])}\n\n` +
    `## DB: mix mercati Tennis CURRENT/CURRENT_BOOTSTRAP\n\n${tableToMarkdown(dbAudit.currentTennisMarketMix || [])}\n\n` +
    `## DB: storico Over/Under rilevato\n\n${tableToMarkdown(dbAudit.totalsLineHistory || [])}\n\n` +
    `## Righe potenzialmente contaminate: Tennis senza sport_type\n\n${tableToMarkdown(dbAudit.possibleContamination || [])}\n\n` +
    `## Interpretazione senior\n\n` +
    `1. Il vecchio storico contiene molte righe Tennis con \`sport_type=NULL\`: non vanno usate per calibrazione o ottimizzazione.\n` +
    `2. Il live Tennis recente è quasi tutto Moneyline 1/2: il problema non è solo il feed, ma anche la selezione finale che prima teneva un solo candidato per match.\n` +
    `3. I totals avevano una distorsione tecnica: moltiplicatori fissi su Over/Under e probabilità estreme. La patch li sostituisce con normalizzazione/shrink/cap e consente al massimo due mercati per match.\n` +
    `4. Finché il sample clean/current resta basso, usare i risultati solo come bootstrap controllato.\n`;
}

function main() {
  ensureDir(OUT_DIR);
  const sourceChecks = analyzeSource();
  const dbAudit = analyzeDb();
  const report = { generatedAt: new Date().toISOString(), sourceChecks, dbAudit };

  fs.writeFileSync(path.join(OUT_DIR, 'senior_audit_results.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'SENIOR_AUDIT_REPORT.md'), buildMarkdown(sourceChecks, dbAudit));

  console.log(`Senior audit completato: ${path.relative(ROOT, OUT_DIR)}`);
  sourceChecks.forEach(c => console.log(`${c.status.padEnd(4)} ${c.id} - ${c.detail}`));
}

main();
