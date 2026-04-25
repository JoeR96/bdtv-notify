#!/usr/bin/env node
'use strict';

// Suppress the "require() of ES Module" experimental warning emitted by
// dependencies that ship ESM-only builds (e.g. @clack/prompts).
const _emit = process.emit.bind(process);
process.emit = function (event, warning) {
  if (
    event === 'warning' &&
    warning?.name === 'ExperimentalWarning' &&
    typeof warning?.message === 'string' &&
    warning.message.includes('require()')
  ) {
    return false;
  }
  return _emit.apply(this, arguments);
};

require('../dist/index.js');
