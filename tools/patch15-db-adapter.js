'use strict';

const path = require('path');
const { createRequire } = require('module');

function openDatabase(dbPath, options = {}) {
  const absolute = path.resolve(dbPath);
  try {
    const localRequire = createRequire(path.join(path.resolve(options.projectRoot || process.cwd()), 'package.json'));
    const Database = localRequire('better-sqlite3');
    const db = new Database(absolute, { readonly: options.readonly === true, fileMustExist: options.fileMustExist !== false });
    return { db, adapter: 'better-sqlite3', native: true };
  } catch (nativeError) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(absolute, { readOnly: options.readonly === true, open: true });
    return { db, adapter: 'node:sqlite', native: false, nativeError: nativeError.message };
  }
}

module.exports = { openDatabase };
