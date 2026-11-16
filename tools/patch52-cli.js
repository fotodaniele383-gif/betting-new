#!/usr/bin/env node
'use strict';
const path = require('path');
function resolveProjectRoot(argv = process.argv.slice(2), fallback = '.') {
  const args = Array.from(argv || []);
  const index = args.indexOf('--root');
  if (index >= 0) {
    if (!args[index + 1] || String(args[index + 1]).startsWith('--')) throw new Error('PATCH52_ROOT_ARGUMENT_REQUIRED');
    return path.resolve(args[index + 1]);
  }
  const positional = args.find(value => value && !String(value).startsWith('--'));
  return path.resolve(positional || fallback);
}
function hasFlag(name, argv = process.argv.slice(2)) { return Array.from(argv || []).includes(name); }
module.exports = { resolveProjectRoot, hasFlag };
