"use strict";
// R8: policy dichiarativa. Non tocca né aggira le regole di accesso di SAFE13.
const fs=require('node:fs'),path=require('node:path');
function check(root){
  const r6=path.join(root,'.bettingapp_main_ui_r6/state.json');
  if(!fs.existsSync(r6))throw Error('R8_R6_MISSING');
  const state=JSON.parse(fs.readFileSync(r6,'utf8'));
  if(state.version!=='BETTINGAPP_MAIN_R6_PROMPT_CALCIO_V63_NO_MINIMAX_WIDGET_20261110')throw Error('R8_R6_RECEIPT_MISMATCH');
  return Object.freeze({
    analysis:'ENABLED_IN_EXISTING_MANUAL_MODE',
    manualBetRegistration:'ENABLED_BY_EXISTING_REAL_MANUAL_ENDPOINT',
    automaticBetExecution:'LOCKED_NO_VERIFIED_BOOKMAKER_ORDER_ADAPTER',
    automaticSettlement:'LOCKED_CERTIFIED_OUTCOME_AND_ACCOUNTING_REQUIRED',
    legacySportsScheduler:'OFF_UNCHANGED_IN_MANUAL_RUNTIME',
    readOnlyDiagnosticScheduler:'AVAILABLE_OPT_IN',
    databaseWrites:false,
    historyMutations:false,
    safe13Bypass:false,
    http423Unchanged:true
  });
}
module.exports={check};
