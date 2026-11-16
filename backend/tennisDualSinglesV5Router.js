'use strict';
// Additive router mounted from server.tennis.js at /api/tennis/dual-singles-v5.
// GET health/prompt + POST simulate. No DB, storage, stake or settlement calls.
const express = require('express');
const fs = require('fs');
const path = require('path');
const core = require('./tennisDualSinglesV5');
const router = express.Router();
const promptFile = path.resolve(__dirname, '..', 'prompts', 'TENNIS_DUAL_SINGLES_V5.txt');
router.get('/health', (_req, res) => res.json({ success:true, version:core.VERSION, readOnly:true, operationalStakeAuthority:false, formats:['BEST_OF_3'], databaseTouched:false }));
router.get('/prompt', (_req, res) => {
  try { return res.type('text/plain; charset=utf-8').send(fs.readFileSync(promptFile,'utf8')); }
  catch (_error) { return res.status(503).json({ success:false, code:'TENNIS_V5_PROMPT_UNAVAILABLE' }); }
});
router.post('/simulate', (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    return res.status(400).json({success:false, code:'INVALID_JSON_OBJECT'});
  const output = core.buildResult({
    budget: req.body.budget,
    favoriteOdds: req.body.favoriteOdds,
    underdogPlus15Odds: req.body.underdogPlus15Odds,
    bestOf: req.body.bestOf === undefined ? 3 : req.body.bestOf,
    oddsEvidence: req.body.oddsEvidence
  });
  // Never read calibrated probabilities or consider stake flags from the caller.
  return res.status(output.status === 'NOT_CALCULABLE' ? 422 : 200).json({success:output.status === 'SIMULATED', ...output});
});
module.exports = router;
