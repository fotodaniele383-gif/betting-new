'use strict';
const path = require('path');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const provider = require(path.join(root,'backend','calcioFootballDataProvider.js'));
const health = provider.getFootballDataHealth();
const result = {
  success: true,
  verificationMode: 'NO_DOWNLOAD_READ_ONLY',
  providerVersion: provider.CALCIO_FOOTBALL_DATA_PROVIDER_VERSION,
  seasonCandidates: provider.buildSeasonCandidates(new Date()),
  health,
  note: health.status === 'NOT_YET_REFRESHED' ? 'Provider installato; nessun dataset locale attivo. Eseguire npm run refresh:calcio:football-data.' : 'Dataset locale verificato senza download.'
};
console.log(JSON.stringify(result,null,2));
