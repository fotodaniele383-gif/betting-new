'use strict';const c=require('./common');
function net(stake,price,win){const q=c.odd(price);if(q===null||!Number.isFinite(stake)||stake<0)throw Error('INVALID_STAKE_OR_ODDS');return win?stake*(q-1):-stake;}
function coverage({favoriteOdds,underdogPlus15Odds,bestOf=3,stakeFavorite,stakeUnderdog}){
 if(![3,5].includes(bestOf))throw Error('INVALID_FORMAT');if(![stakeFavorite,stakeUnderdog].every(x=>Number.isFinite(x)&&x>=0))throw Error('INVALID_STAKES');
 const scores=bestOf===3?[[2,0],[2,1],[1,2],[0,2]]:[[3,0],[3,1],[3,2],[2,3],[1,3],[0,3]];
 const rows=scores.map(([f,u])=>{const favoriteWin=f>u,underPlusWin=u+1.5>f;return {score:`${f}-${u}`,favoriteWin,underdogPlus15Win:underPlusWin,profit:net(stakeFavorite,favoriteOdds,favoriteWin)+net(stakeUnderdog,underdogPlus15Odds,underPlusWin)};});
 return {status:'SIMULATION_ONLY',operationalStakeEur:0,scenarios:rows,worstNet:Math.min(...rows.map(x=>x.profit)),bestNet:Math.max(...rows.map(x=>x.profit)),ev:'NOT_CERTIFIED',retirementRules:'UNVERIFIED'};
}
module.exports={coverage};
