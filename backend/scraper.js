// ============================================================================
// scraper.js - Compatibility facade for Calcio Patch 10 Understat Provider V2
// ============================================================================
'use strict';

// Legacy Patch 7 verifier marker retained: UNDERSTAT_NO_VALID_NAMED_TEAM_ROWS.
// Patch 10 replaces the generic runtime error with typed V2 states and circuit breaking.

const provider = require('./calcioUnderstatProviderV2');

module.exports = {
    getUnderstatxG: provider.getUnderstatxG,
    getUnderstatState: provider.getUnderstatState,
    classifySeasonForKickoff: provider.classifySeasonForKickoff,
    understatLeagueMap: provider.understatLeagueMap,
    CALCIO_UNDERSTAT_PROVIDER_VERSION: provider.CALCIO_UNDERSTAT_PROVIDER_VERSION
};
