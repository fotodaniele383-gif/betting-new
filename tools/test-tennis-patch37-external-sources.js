#!/usr/bin/env node
'use strict';
const assert=require('assert');const mod=require('../backend/tennisExternalMatchIntelligencePatch37');
assert.equal(mod.resolveVenue({tournament:'Citi Open Washington'}).id,'washington');
assert.equal(mod.resolveVenue({tournament:'Paris Masters',surface:'Hard indoor'}).status,'INDOOR_NO_WEATHER');
assert.equal(mod.extractRankFromHtml('<tr><td>12</td><td>Example Player</td></tr>','Example Player'),12);
const risk=mod.weatherRisk({temperatureC:36,humidityPct:84,precipitationProbabilityPct:75,windKph:32,gustKph:48});assert(risk.score>=80);assert(risk.confidencePenalty>0);
assert.throws(()=>mod.assertAllowedUrl('https://example.com/x'),/EXTERNAL_HOST_NOT_ALLOWED/);
assert.doesNotThrow(()=>mod.assertAllowedUrl('https://api.open-meteo.com/v1/forecast'));
const rank=mod.rankingConflict({p1:{name:'A',rank:10},p2:{name:'B',rank:50}},{players:[{name:'A',rank:11,verified:true,parserConfidence:.9},{name:'B',rank:100,verified:true,parserConfidence:.9}]});assert.equal(rank.conflict,true);assert.equal(rank.players[0].conflict,false);
const health=mod.sourceHealth();assert.equal(health.sources.MATCH_CHARTING_PROJECT.enabled,false);assert.equal(health.officialRankingProbabilityAuthority,false);assert.equal(health.weatherStakeAuthority,false);
(async()=>{const r=await mod.buildExternalMatchIntelligence({p1Name:'Novak Djokovic',p2Name:'Carlos Alcaraz',prediction:'1',tour:'ATP',surface:'Hard',context:{tournament:'US Open',match_date:'2026-08-30T18:00:00Z'}},{skipNetwork:true});assert.equal(r.authority.finalStake,false);assert.equal(r.officialRankings.status,'NETWORK_SKIPPED');assert.equal(r.weather.status,'NETWORK_SKIPPED');console.log(JSON.stringify({success:true,checks:15,weatherRisk:risk,health},null,2));})().catch(e=>{console.error(e);process.exit(1);});
