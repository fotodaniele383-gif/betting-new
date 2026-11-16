
'use strict';

// V2.2 - MONITOR SHADOW TENNIS / CALCIO
// Non modifica database, stake, V1 o server.js

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const VERSION = 'PAPER_PROMOTION_V22_SHADOW';
const source = path.join(__dirname, 'paperPromotionAuditV2.js');
const folder = path.join(__dirname, 'paper-promotion-v22-shadow');
const target = path.join(folder, 'status.json');

const digest = x =>
  crypto.createHash('sha256').update(x).digest('hex');

const hash = x => digest(JSON.stringify(x));
const number = x => typeof x === 'number' && Number.isFinite(x);

function classify(g) {
  if (g.retro > 0) return 'CALCIO_RETRO_DIAGNOSTICA';
  if (g.dev < 30) return 'STUDIO_CAMPIONE_DEV';
  if (g.roiDev === null || g.roiDev <= 0)
    return 'STUDIO_DEV_NON_POSITIVO';

  if (g.holdout >= 5 && number(g.roiHoldout) && g.roiHoldout <= 0)
    return 'HOLDOUT_NEGATIVO_PRELIMINARE';

  if (g.holdout > 0 && g.holdout < 5 &&
      number(g.roiHoldout) && g.roiHoldout < 0)
    return 'HOLDOUT_ESIGUO_NEGATIVO';

  if (g.dev < 100) return 'CANDIDATA_SHADOW';
  if (g.holdout < 30)
    return 'VALIDAZIONE_HOLDOUT_INSUFFICIENTE';

  if (g.deep < Math.ceil((g.dev + g.holdout) * 0.8))
    return 'QUALITA_DEEPSCAN_INSUFFICIENTE';

  if (g.blocked > 0 || g.approved === 0)
    return 'GATE_DA_RICONCILIARE';

  return 'REVISIONE_INDIPENDENTE_NECESSARIA';
}

function validate(meta, rows) {
  if (!meta || meta.tennisHashChain !== true ||
      !meta.tennis || !meta.calcio ||
      !Array.isArray(rows) || rows.length !== meta.groups)
    throw Error('CONTRATTO_V21_INVALIDO');

  let tennis = 0, calcio = 0;
  const seen = new Set();

  for (const r of rows) {
    if (!r || typeof r.gruppo !== 'string' ||
        seen.has(r.gruppo))
      throw Error('GRUPPO_DUPLICATO_O_INVALIDO');

    seen.add(r.gruppo);

    for (const f of ['dev','holdout','retro','deep','approved','blocked'])
      if (!Number.isInteger(r[f]) || r[f] < 0)
        throw Error('CONTATORE_INVALIDO_' + f);

    for (const f of ['roiDev','roiHoldout','roiRetro'])
      if (r[f] !== null && !number(r[f]))
        throw Error('ROI_INVALIDO_' + f);

    if (r.gruppo.startsWith('TENNIS / ')) {
      if (r.retro !== 0) throw Error('COORTE_TENNIS_INVALIDA');
      tennis += r.dev + r.holdout;
    } else if (r.gruppo.startsWith('CALCIO / ')) {
      if (r.dev !== 0 || r.holdout !== 0)
        throw Error('COORTE_CALCIO_INVALIDA');
      calcio += r.retro;
    } else {
      throw Error('SPORT_NON_RICONOSCIUTO');
    }
  }

  if (tennis !== meta.tennis.valid ||
      calcio !== meta.calcio.valid)
    throw Error('CONTATORI_NON_RICONCILIATI');
}

function getAudit() {
  let rows = null, meta = null; const markers = new Set();

  const oldLog = console.log;
  const oldTable = console.table;

  console.log = (...parts) => {
    const x = parts[0];

    if (parts.length === 1 && typeof x === 'string') {
      if (x.trim().startsWith('{') &&
          x.includes('"tennisHashChain"'))
        meta = JSON.parse(x);

      if (['AUTORITA_STAKE=NO','AUTORITA_PROMOZIONE=NO','DATABASE_INVARIATO'].includes(x.trim())) markers.add(x.trim());
    }
  };

  console.table = x => {
    if (Array.isArray(x) &&
        x.some(r => r &&
          r.decision === 'NO_PROMOTION_SHADOW_ONLY'))
      rows = x;
  };

  try {
    delete require.cache[require.resolve(source)];
    require(source);
  } finally {
    console.log = oldLog;
    console.table = oldTable;
  }

  if (!['AUTORITA_STAKE=NO','AUTORITA_PROMOZIONE=NO','DATABASE_INVARIATO'].every(x => markers.has(x))) throw Error('V21_NON_CONFERMA_SOLA_LETTURA');

  validate(meta, rows);
  return {meta, rows};
}

function getPrevious() {
  if (!fs.existsSync(target)) return null;

  const envelope = JSON.parse(
    fs.readFileSync(target, 'utf8')
  );

  if (!envelope.payload ||
      envelope.sha256 !== hash(envelope.payload) ||
      envelope.payload.version !== VERSION)
    throw Error('STATO_V22_CORROTTO');

  return envelope.payload;
}

function run() {
  if (!fs.existsSync(source))
    throw Error('MODULO_V21_MANCANTE');

  const sourceSha = digest(fs.readFileSync(source));
  const prev = getPrevious();

  if (prev && prev.auditSourceSha256 !== sourceSha)
    throw Error('SORGENTE_V21_MODIFICATO: RICHIESTA REVISIONE');

  const {meta, rows} = getAudit();

  const groups = rows.map(r => ({
    key: r.gruppo,
    stato: classify(r),
    dev: r.dev,
    roiDev: r.roiDev,
    holdout: r.holdout,
    roiHoldout: r.roiHoldout,
    retro: r.retro,
    roiRetro: r.roiRetro,
    deep: r.deep,
    approved: r.approved,
    blocked: r.blocked,
    stakeAuthority: false
  })).sort((a,b) => a.key.localeCompare(b.key));

  const oldStates = new Map(
    (prev?.groups || []).map(g => [g.key, g.stato])
  );

  const changes = groups
    .filter(g =>
      oldStates.has(g.key) &&
      oldStates.get(g.key) !== g.stato
    )
    .map(g => ({
      at: new Date().toISOString(),
      key: g.key,
      from: oldStates.get(g.key),
      to: g.stato
    }));

  const transitions = [
    ...(prev?.transitions || []),
    ...changes
  ];

  if (transitions.length > 10000)
    throw Error('LIMITE_TRANSIZIONI: REVISIONE NECESSARIA');

  const payload = {
    version: VERSION,
    auditSourceSha256: sourceSha,
    at: new Date().toISOString(),
    tennis: meta.tennis,
    calcio: meta.calcio,
    tennisHashChain: true,
    groups,
    transitions,
    clvRequired: false,
    executionIntegrated: false,
    futureStakeAuthority: false,
    historyModified: false
  };

  fs.mkdirSync(folder, {recursive:true});

  const temp = target + '.tmp-' + process.pid;

  try {
    fs.writeFileSync(
      temp,
      JSON.stringify({
        payload,
        sha256: hash(payload)
      }, null, 2),
      {flag:'wx'}
    );
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }

  console.log('\nV2.2 SHADOW: ' + payload.at);
  console.log(
    'Tennis validi: ' + meta.tennis.valid +
    '; Calcio validi: ' + meta.calcio.valid +
    '; Gruppi: ' + groups.length
  );

  console.table(groups.map(g => ({
    gruppo: g.key.slice(0,72),
    dev: g.dev,
    holdout: g.holdout,
    retro: g.retro,
    roiDev: g.roiDev,
    roiHoldout: g.roiHoldout,
    stato: g.stato
  })));

  console.log(
    'Transizioni shadow nuove: ' + changes.length +
    '; CLV obbligatorio: NO'
  );
  console.log(
    'STAKE_AUTOMATICO=NO; ' +
    'PROMOZIONE_OPERATIVA=NO; DB_NON_MODIFICATO'
  );
}

function selfTest() {
  const base = {
    retro:0, dev:34, holdout:9,
    roiDev:21.06, roiHoldout:5.67,
    deep:33, approved:0, blocked:0
  };

  assert.equal(classify(base), 'CANDIDATA_SHADOW');

  assert.equal(
    classify({...base,holdout:11,roiHoldout:-9.45}),
    'HOLDOUT_NEGATIVO_PRELIMINARE'
  );

  assert.equal(
    classify({...base,dev:12}),
    'STUDIO_CAMPIONE_DEV'
  );

  assert.equal(
    classify({...base,dev:46,holdout:4,roiHoldout:-21.25}),
    'HOLDOUT_ESIGUO_NEGATIVO'
  );

  assert.equal(
    classify({...base,dev:110,holdout:40,deep:150,approved:0}),
    'GATE_DA_RICONCILIARE'
  );

  assert.equal(
    classify({...base,retro:20,dev:0}),
    'CALCIO_RETRO_DIAGNOSTICA'
  );

  assert.throws(() => validate(
    {tennisHashChain:true,tennis:{valid:1},calcio:{valid:0},groups:1},
    [{
      gruppo:'TENNIS / X',
      dev:2,holdout:0,retro:0,
      deep:0,approved:0,blocked:0,
      roiDev:1,roiHoldout:null,roiRetro:null
    }]
  ), /CONTATORI/);

  const p = {version:VERSION,foo:1};
  assert.notEqual(hash(p), hash({...p,foo:2}));

  console.log('V2.2 SELF-TEST: 8 CONTROLLI SUPERATI');
}

if (require.main === module) {
  try {
    if (process.argv.includes('--test')) {
      selfTest();
    } else if (process.argv.includes('--watch')) {
      console.log(
        'V2.2 in osservazione ogni 10 minuti. ' +
        'Arrestare con CTRL+C.'
      );

      run();

      setInterval(() => {
        try {
          run();
        } catch(e) {
          console.error('FAIL-CLOSED: ' + e.message);
          process.exitCode = 2;
          process.exit();
        }
      }, 600000);

    } else {
      run();
    }

  } catch(e) {
    console.error('V2.2 FAIL-CLOSED: ' + e.message);
    process.exitCode = 2;
  }
}

module.exports = {classify, validate};
