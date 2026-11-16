# AUDIT16B — Calcio Analysis Performance

Ordine: **2/3**. Baseline richiesta: **AUDIT16A applicata**.

## Scopo
Velocizza il calcolo storico dell analisi Calcio senza cambiare formule o probabilita: parse delle date CSV una sola volta e snapshot memoizzati per kickoff identico, sempre restituiti come copia isolata.

## Installazione
1. Chiudere BettingApp/server Node e ngrok.
2. Estrarre la cartella `AUDIT16B` nella root dove sono presenti `backend`, `tools` e `package.json`.
3. Eseguire: `AUDIT16B\AGGIORNA.cmd`
4. Se verify/regressione falliscono, il rollback parte automaticamente.

## Controllo read-only
`AUDIT16B\05_benchmark.cmd`

## Autorita non modificate
Nessuna patch attiva produzione reale, non aumenta stake, non cambia probabilita per ottenere test verdi e non riscrive risultati storici.
