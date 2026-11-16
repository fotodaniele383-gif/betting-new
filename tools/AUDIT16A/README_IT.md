# AUDIT16A — Calcio Scheduler Atomic Persistence

Ordine: **1/3**. Baseline richiesta: **nuova baseline AUDIT16 del 25/09**.

## Scopo
Rende atomica la persistenza configurazione Calcio + calcio_scheduler_state Patch58. Gli errori di state sync/read-back/schedule non vengono piu silenziati; config/state/event ledger vengono ripristinati in caso di failure.

## Installazione
1. Chiudere BettingApp/server Node e ngrok.
2. Estrarre la cartella `AUDIT16A` nella root dove sono presenti `backend`, `tools` e `package.json`.
3. Eseguire: `AUDIT16A\AGGIORNA.cmd`
4. Se verify/regressione falliscono, il rollback parte automaticamente.

## Controllo read-only
`AUDIT16A\05_status.cmd`

## Autorita non modificate
Nessuna patch attiva produzione reale, non aumenta stake, non cambia probabilita per ottenere test verdi e non riscrive risultati storici.
