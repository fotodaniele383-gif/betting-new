# AUDIT12 — Settlement Resolution Proof Hardening

## Obiettivo

AUDIT12 rende **fail-closed** la transizione di una settlement exception Tennis da `OPEN` a `RESOLVED`.

La patch **non risolve automaticamente nessuna eccezione esistente**, non modifica il modello, non cambia probabilità/stake/CLV, non abilita real-money e non esegue recovery di rete.

Interviene solo sul contratto di risoluzione futuro: una eccezione production-relevant può uscire dalla coda soltanto se il settlement appena acquisito porta una prova coerente e certificabile.

## Regole AUDIT12

Per la risoluzione automatica `TARGETED_OFFICIAL_RESULT` sono richiesti contemporaneamente:

- sport `TENNIS`;
- queue ancora `OPEN`;
- eccezione **non** marcata `manual_action_required`;
- stato finale `WON`, `LOST`, `VOID` o `PUSH`;
- `settlement_contract_status = VERIFIED`;
- `settlement_contract_reason = CONTRACT_OK`;
- source tier ufficiale: solo `CERTIFIED` o `PROVIDER`;
- source non `UNKNOWN/PENDING/WEAK/MANUAL/FALLBACK/LEGACY`;
- `settlement_source_event_id` presente;
- evidence hash SHA-256 valido;
- fingerprint settlement/evento uguale alla fingerprint canonica;
- fingerprint settlement/mercato uguale alla fingerprint canonica;
- timestamp evento, osservazione e settlement validi e ordinati `eventStart <= observedAt <= settledAt`;
- `settlement_operation_id` coerente con l'operazione che richiede la risoluzione.

Se una sola condizione fallisce, la queue resta `OPEN` con azione `RESOLUTION_BLOCKED`.

Le eccezioni manuali (`MANUAL_BOOKMAKER_RULE`, `MANUAL_CONTRACT_REVIEW`, ecc.) **non possono essere auto-risolte** da questo percorso.

## Coerenza atomica

Nel normale lifecycle Paper Trading Tennis, se AUDIT12 blocca la chiusura della exception, il callback atomico solleva `AUDIT12_SETTLEMENT_EXCEPTION_RESOLUTION_BLOCKED`: la transazione settlement viene annullata invece di lasciare uno stato finale incoerente con una coda ancora bloccante.

Quando la risoluzione è valida, la riga della queue viene riallineata all'evidenza finale certificata e `evidence_key` diventa il `resolutionEvidenceHash` AUDIT12. L'evento append-only `RESOLVED` conserva anche la prova e la policy version.

## File modificati

- `backend/tennisSettlementExceptionQueuePatch51.js`
- `backend/paperTrading.tennis.js`
- `tools/test-tennis-patch51-settlement-exception-queue.js`

## File nuovi

- `backend/settlementResolutionEvidenceGateAudit12.js`
- `tools/test-tennis-audit12-settlement-resolution-evidence.js`

## Applicazione

Estrarre la cartella `AUDIT12` nella root BettingApp, dove sono presenti `backend`, `tools` e `package.json`.

Chiudere BettingApp/server e ngrok, poi eseguire:

```cmd
AUDIT12\AGGIORNA.cmd
```

Sequenza automatica:

1. preflight e hash baseline post-AUDIT11;
2. 11 regression suite baseline;
3. backup dei file interessati;
4. apply;
5. test mirati AUDIT12/Patch51;
6. verify;
7. regressione completa post-patch: 12 suite;
8. rollback automatico se un gate fallisce.

## Rollback manuale

```cmd
AUDIT12\04_rollback.cmd
```

Il rollback ripristina i tre file preesistenti e rimuove i due file introdotti da AUDIT12.

## Cosa AUDIT12 non fa

- non marca le 22 settlement exception attuali come `RESOLVED`;
- non recupera risultati da Internet;
- non certifica retroattivamente fonti weak/legacy;
- non modifica database durante installazione/verifica;
- non modifica readiness threshold;
- non bypassa Patch55/56/57/58/59;
- non abilita il real-money.

Le 22 eccezioni production-relevant continueranno a bloccare Tennis fino a quando ciascuna non riceverà evidenza valida secondo il nuovo contratto oppure un intervento manuale esplicito nel caso delle eccezioni manuali.
