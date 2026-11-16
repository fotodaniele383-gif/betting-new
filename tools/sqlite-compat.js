'use strict';
let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  Database = class DatabaseCompat extends DatabaseSync {
    constructor(file, options = {}) {
      super(file, options && options.readonly ? { readOnly: true } : {});
    }
  };
}
module.exports = Database;
