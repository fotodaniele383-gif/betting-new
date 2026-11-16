'use strict';
// Aggiornamento una tantum delle CSV pubbliche Calcio, solo cache della copia pulita.
// Non esegue scheduler, settlement, bankroll o alterazioni dello storico SQLite.
const path=require('node:path');
async function refresh(options={}){
 const p=require(path.join(__dirname,'backend','calcioFootballDataProvider.js'));
 const league=p.DEFAULT_LEAGUES.find(x=>String(x.key||'').toLowerCase()==='serie_a'||String(x.name||'').toLowerCase()==='serie a'||x.code==='I1');
 if(!league)return 'SERIE_A_NON_CONFIGURATA';
 const r=await p.getLeagueCsv({...league,leagueKey:league.key,leagueName:league.name,forceRefresh:!!options.force});
 return 'SERIE_A fonte='+(r?.source||'NESSUNA')+' record='+(r?.validRows??0)+'; nessuna modifica al database';
}
if(require.main===module)refresh({force:process.argv.includes('--force')}).then(v=>console.log('AGGIORNAMENTO='+v)).catch(e=>{console.error('AGGIORNAMENTO_ERRORE='+e.message);process.exitCode=1});
module.exports={refresh};
