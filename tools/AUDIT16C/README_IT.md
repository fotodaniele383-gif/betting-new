# AUDIT16C — Calcio CLV Opening Capture Reliability

Ordine: **3/3**. Baseline richiesta: **AUDIT16A e AUDIT16B applicate**.

## Scopo
Migliora la CLV Calcio: cattura opening odd, timestamp, bookmaker, source-event, fingerprint evento/mercato e sport-key al momento dell analisi; salva nel vault le quote gia scaricate senza nuova chiamata API. Non inventa closing line e non backfilla il passato.

## Installazione
1. Chiudere BettingApp/server Node e ngrok.
2. Estrarre la cartella `AUDIT16C` nella root dove sono presenti `backend`, `tools` e `package.json`.
3. Eseguire: `AUDIT16C\AGGIORNA.cmd`
4. Se verify/regressione falliscono, il rollback parte automaticamente.

## Controllo read-only
`AUDIT16C\05_clv_coverage.cmd`

## Autorita non modificate
Nessuna patch attiva produzione reale, non aumenta stake, non cambia probabilita per ottenere test verdi e non riscrive risultati storici.
