#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const rootArg = process.argv.indexOf('--root');
const root = path.resolve(rootArg >= 0 && process.argv[rootArg + 1] ? process.argv[rootArg + 1] : path.join(__dirname, '..'));
const httpMod = require(path.join(root, 'backend', 'audit07sR5UnderstatHttp.js'));
const provider = require(path.join(root, 'backend', 'calcioUnderstatProviderV2.js'));
const details = [];
const failures = [];
function add(name, ok, info = null) { const row = { name, ok: !!ok, details: info }; details.push(row); if (!row.ok) failures.push(row); }
function datesFixture() {
  const dates = [];
  for (let i = 0; i < 10; i += 2) {
    dates.push({
      h: { title: `Team ${i + 1}` }, a: { title: `Team ${i + 2}` },
      xG: { h: 1.1 + i / 100, a: 0.8 + i / 100 }, isResult: true
    });
  }
  return { teams: {}, dates, players: [] };
}
(async () => {
  try {
    add('HTTP wire revision exported', httpMod.AUDIT16D_R3_R3A_R4_HTTP_WIRE_VERSION === 'AUDIT16D_R3_R3A_R4_UNDERSTAT_GZIP_WIRE_DECODE_V1', httpMod.AUDIT16D_R3_R3A_R4_HTTP_WIRE_VERSION);
    add('Provider wire revision exported', provider.AUDIT16D_R3_R3A_R4_WIRE_VERSION === 'AUDIT16D_R3_R3A_R4_UNDERSTAT_GZIP_AND_ENDPOINT_ALIAS_V1', provider.AUDIT16D_R3_R3A_R4_WIRE_VERSION);

    const sample = Buffer.from(JSON.stringify(datesFixture()), 'utf8');
    const gz = zlib.gzipSync(sample);
    const decodedHeader = httpMod.decodeUnderstatBody(gz, { 'content-encoding': 'gzip' });
    add('GZIP header is decompressed before UTF-8 decoding', decodedHeader.equals(sample), { compressedBytes: gz.length, decodedBytes: decodedHeader.length });
    const decodedMagic = httpMod.decodeUnderstatBody(gz, {});
    add('GZIP magic fallback works when content-encoding header is missing', decodedMagic.equals(sample), { magic: gz.subarray(0, 2).toString('hex') });
    const plain = httpMod.decodeUnderstatBody(sample, {});
    add('Plain response remains byte-identical', plain.equals(sample), { bytes: plain.length });

    const aliases = provider.apiLeagueSegments('Serie A', 'Serie_A');
    add('Serie A keeps stable slug first and browser-observed alias second', aliases[0] === 'Serie_A' && aliases.includes('Serie A'), aliases);
    const aliasUrl = provider.buildLeagueDataUrl('Serie A', 2026);
    add('Display-name alias is URL-encoded safely', aliasUrl === 'https://understat.com/getLeagueData/Serie%20A/2026', aliasUrl);

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'audit16d-r3-r3a-r4-'));
    const calls = [];
    provider.resetUnderstatRuntimeForTests();
    const teams = await provider.getUnderstatxG('Serie A', {
      force: true,
      seasonCandidates: [2026],
      cacheDir: temp,
      disableSessionRecovery: true,
      fetchJson: async (url) => {
        calls.push(url);
        if (/Serie_A/.test(url)) {
          const e = new Error('UNDERSTAT_AJAX_JSON_INVALID');
          e.code = 'UNDERSTAT_AJAX_JSON_INVALID'; e.structural = true; throw e;
        }
        return datesFixture();
      }
    });
    const state = provider.getUnderstatState('Serie A');
    add('Provider retries browser-observed API alias after slug failure', calls.length >= 2 && calls.some(x => x.includes('Serie%20A')), calls);
    add('Alias retry still returns certified real Understat xG', Object.keys(teams).length >= 8 && Object.values(teams).every(x => x.providerId === 'UNDERSTAT' && x.evidenceClass === 'REAL_XG'), { teams: Object.keys(teams).length, state });
    add('Runtime records selected API segment and wire revision', state.apiLeagueSegment === 'Serie A' && state.wireRevision === provider.AUDIT16D_R3_R3A_R4_WIRE_VERSION, state);
    fs.rmSync(temp, { recursive: true, force: true });
  } catch (e) {
    failures.push({ name: 'Unhandled test exception', ok: false, details: { code: e.code || null, message: e.message, stack: e.stack } });
  }
  const out = { success: failures.length === 0, patch: 'AUDIT16D_R3_R3A_R4', suite: 'UNDERSTAT_GZIP_WIRE_AND_API_ALIAS', checks: details.length, failures, details };
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.success ? 0 : 1);
})();
