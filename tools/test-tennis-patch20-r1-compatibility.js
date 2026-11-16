'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const registry = require(path.join(root, 'backend', 'tennisPatchRegistry'));
const refresh = require(path.join(root, 'backend', 'tennisPlayerDataRefresh'));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const patch18TestPath = path.join(root, 'backend', 'tests', 'patch18TennisStatisticalChallenger.test.js');
const patch18Test = fs.readFileSync(patch18TestPath, 'utf8');
const sources = refresh.defaultSources(2026);

assert(Number(registry.TENNIS_CURRENT_PATCH_VERSION) >= 20, `REGISTRY_EXPECTED_20_PLUS:${registry.TENNIS_CURRENT_PATCH_VERSION}`);
assert(refresh.TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION === 'TENNIS_PLAYER_DATA_REQUEST_POLICY_V2_PATCH20_R1', 'REQUEST_POLICY_R1_MISSING');
assert(refresh.ALLOWED_HOSTS.has('raw.githubusercontent.com'), 'RAW_HOST_MISSING');
assert(refresh.ALLOWED_HOSTS.has('api.github.com'), 'GITHUB_API_HOST_MISSING');
assert(sources.every(source => {
  const candidates = refresh.sourceUrlCandidates(source);
  return candidates.length === 3
    && candidates[0].includes('raw.githubusercontent.com')
    && candidates[1].includes('api.github.com/repos/')
    && candidates[1].includes('/contents/')
    && candidates[2].includes('/refs/heads/master/');
}), 'SOURCE_CANDIDATE_POLICY_INVALID');
assert(patch18Test.includes('PATCH${registry.TENNIS_CURRENT_PATCH_VERSION}'), 'PATCH18_DYNAMIC_PROGRESSION_ASSERTION_MISSING');
assert(!patch18Test.includes('6_PATCH18|7_PATCH19'), 'PATCH18_FINITE_PROGRESSION_ENUMERATION_STILL_PRESENT');

const report = {
  success: true,
  patch: '20-R1',
  registryPatch: registry.TENNIS_CURRENT_PATCH_VERSION,
  requestPolicyVersion: refresh.TENNIS_PLAYER_DATA_REQUEST_POLICY_VERSION,
  allowedHosts: [...refresh.ALLOWED_HOSTS],
  sourceCandidates: Object.fromEntries(sources.map(source => [source.id, refresh.sourceUrlCandidates(source)])),
  patch18DynamicProgressionAssertion: true,
  generatedAt: new Date().toISOString()
};

console.log(JSON.stringify(report, null, 2));
