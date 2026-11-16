#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const root = path.resolve(__dirname, '..');
const checks = [];
function check(name, fn) { try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error: error.message }); } }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch31-release-test-'));
const fixture = path.join(temp, 'fixture'); fs.mkdirSync(path.join(fixture, 'backend'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', version: '21.18.0' }));
fs.writeFileSync(path.join(fixture, 'app.js'), 'console.log("safe")');
fs.writeFileSync(path.join(fixture, '.env'), 'SECRET=LOCAL_ONLY');
fs.writeFileSync(path.join(fixture, 'backend', 'database_betting.db'), 'not-a-real-db');
fs.writeFileSync(path.join(fixture, 'backend', 'tennisPatchRegistry.js'), "const TENNIS_CURRENT_PATCH_VERSION = '31';");
const out = path.join(temp, 'safe.zip');
const result = cp.spawnSync(process.execPath, [path.join(root, 'tools/build-betting-safe-release.js'), `--root=${fixture}`, `--output=${out}`, '--max-mib=5'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
let json = null; try { json = JSON.parse(result.stdout); } catch (_) {}
check('builder exit 0', () => assert.equal(result.status, 0, result.stderr || result.stdout));
check('builder success', () => assert.equal(json?.success, true));
check('zip creato', () => assert(fs.existsSync(out) && fs.statSync(out).size > 0));
check('manifest segnala no secrets', () => assert.equal(json?.manifest?.secretValuesIncluded, false));
check('manifest segnala no database', () => assert.equal(json?.manifest?.databaseIncluded, false));
check('manifest segnala no backup', () => assert.equal(json?.manifest?.backupsIncluded, false));
check('manifest segnala no env', () => assert.equal(json?.manifest?.environmentFilesIncluded, false));
check('scan staging sano', () => assert.equal(json?.scan?.healthy, true));
check('checksum zip presente', () => assert.equal(String(json?.archiveSha256 || '').length, 64));
check('metodo archivio noto', () => assert(['PYTHON_ZIPFILE','POWERSHELL_COMPRESS_ARCHIVE','ZIP_CLI'].includes(json?.archiveMethod)));
fs.rmSync(temp, { recursive: true, force: true });
const failed = checks.filter(x => !x.ok);
console.log(JSON.stringify({ success: !failed.length, checks, passed: checks.length - failed.length, failed: failed.length }, null, 2));
process.exit(failed.length ? 1 : 0);
