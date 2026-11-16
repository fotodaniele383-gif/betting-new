'use strict';const c=require('./common');
// Returns net profit per unit for a single full/half/quarter Asian line.
function single(outcome,odd){if(outcome>1e-9)return odd-1;if(outcome< -1e-9)return -1;return 0;}
function split(line){if(!Number.isFinite(line))throw Error('INVALID_LINE');const q=Math.round(line*4);if(Math.abs(line-q/4)>1e-8)throw Error('NOT_QUARTER_LINE');if(Math.abs(q)%2===1)return [(q-1)/4,(q+1)/4];return [line,line];}
function payoff({market,side,line,homeGoals,awayGoals,odd:price}){
 const q=c.odd(price);if(q===null)throw Error('INVALID_ODDS');
 if(![homeGoals,awayGoals].every(x=>Number.isInteger(x)&&x>=0))throw Error('INVALID_SCORE');
 const sideToken=String(side||'').toUpperCase();let diff;
 if(market==='TOTALS'){const total=homeGoals+awayGoals;diff=(sideToken==='OVER'?total:-total);if(!['OVER','UNDER'].includes(sideToken))throw Error('INVALID_SIDE');const values=split(line).map(l=>single(sideToken==='OVER'?diff-l:diff+l,q));return (values[0]+values[1])/2;}
 if(market==='HANDICAP'){if(!['HOME','AWAY'].includes(sideToken))throw Error('INVALID_SIDE');diff=(sideToken==='HOME'?homeGoals-awayGoals:awayGoals-homeGoals);const values=split(line).map(l=>single(diff+l,q));return (values[0]+values[1])/2;}
 throw Error('UNKNOWN_MARKET');
}
function expectedValue({states,...market}){
 if(!Array.isArray(states)||!states.length)throw Error('DISTRIBUTION_MISSING');let mass=0,ev=0;
 for(const s of states){const p=c.number(s.p);if(p===null||p<0||p>1)throw Error('BAD_PROBABILITY_MASS');mass+=p;ev+=p*payoff({...market,homeGoals:s.homeGoals,awayGoals:s.awayGoals});}
 if(Math.abs(mass-1)>1e-6)throw Error('DISTRIBUTION_NOT_NORMALIZED');return {evPct:ev*100,scenarios:states.length};
}
module.exports={payoff,expectedValue,split};
