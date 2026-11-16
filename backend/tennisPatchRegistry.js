'use strict';

/**
 * Tennis patch registry.
 *
 * Legacy patches remain source-compatible (STEPxx markers are not renamed),
 * but are catalogued under the frozen baseline 0.x. All new work starts at
 * PATCH 1 and must be registered here before being enabled at runtime.
 */

const TENNIS_LEGACY_BASELINE_VERSION = '0';
const TENNIS_CURRENT_PATCH_VERSION = '59';
const TENNIS_PATCH_REGISTRY_VERSION = 'TENNIS_PATCH_REGISTRY_V59';

const LEGACY_BASELINE_GROUPS = Object.freeze([
  Object.freeze({
    version: '0.1',
    minStep: 2,
    maxStep: 21,
    area: 'CORE_MODEL_UI',
    description: 'Motore Tennis iniziale, health, calibrazione, gate e prime integrazioni UI.'
  }),
  Object.freeze({
    version: '0.2',
    minStep: 22,
    maxStep: 49,
    area: 'GATE_PORTFOLIO_CONSENSUS',
    description: 'Stake policy, DeepScan, portafoglio, gate e consensus pre-match.'
  }),
  Object.freeze({
    version: '0.3',
    minStep: 50,
    maxStep: 69,
    area: 'TOTALS_CLV_OPERATIONAL',
    description: 'Totals, API efficiency, settlement, CLV, scope operativo ed explainability.'
  }),
  Object.freeze({
    version: '0.4',
    minStep: 70,
    maxStep: 89,
    area: 'UI_BOOTSTRAP_RELIABILITY',
    description: 'Dashboard, bootstrap storico, reliability e ripristini frontend/portfolio.'
  }),
  Object.freeze({
    version: '0.5',
    minStep: 90,
    maxStep: 99,
    area: 'PREMATCH_PERSISTENCE_SIDE_GUARDS',
    description: 'Gate canonico, persistenza Paper Trading, identità lato e final guard runtime.'
  }),
  Object.freeze({
    version: '0.6',
    minStep: 100,
    maxStep: 110,
    area: 'CLV_SETTLEMENT_CERTIFICATION',
    description: 'Stabilità CLV, settlement certificato, summary e notifiche.'
  }),
  Object.freeze({
    version: '0.7',
    minStep: 111,
    maxStep: 117,
    area: 'FINAL_CATALOG_PORTABILITY',
    description: 'Catalogo torneo/superficie, compatibilità strutturale e portabilità finale.'
  })
]);

const PATCHES = Object.freeze([
  Object.freeze({
    version: TENNIS_LEGACY_BASELINE_VERSION,
    status: 'FROZEN_BASELINE',
    title: 'Legacy Tennis consolidated baseline',
    groups: LEGACY_BASELINE_GROUPS.map(group => group.version)
  }),
  Object.freeze({
    version: '1',
    status: 'ACTIVE_FOUNDATION',
    title: 'Unified Tennis patch registry and pending persistence pipeline',
    scope: Object.freeze([
      'Legacy STEP inventory mapped to baseline 0.x',
      'Single ordered pipeline for Tennis PENDING pre-lookup/upsert/insert',
      'Runtime patch status exposed by /api/tennis/health',
      'Behavior-preserving structural refactor with regression checks'
    ])
  }),
  Object.freeze({
    version: '2',
    status: 'ACTIVE',
    title: 'Tennis match format contract',
    scope: Object.freeze([
      'WTA Grand Slam singles resolved as best-of-3',
      'ATP Grand Slam main-draw singles resolved as best-of-5',
      'Qualifying, doubles and ambiguous contexts default safely to best-of-3',
      'Only certified provider format metadata can override inference',
      'Match-format diagnostics exposed in health and candidate references'
    ])
  }),
  Object.freeze({
    version: '3',
    status: 'ACTIVE',
    title: 'Canonical Tennis event and market identity',
    scope: Object.freeze([
      'Provider event id has priority over schedule changes',
      'Fallback identity includes canonical date, tour, tournament and player pair',
      'Market fingerprint separates market, selected side and point line',
      'Rematches never update an older PENDING row by names alone',
      'Ambiguous or duplicate identities are blocked from overwrite and operational stake'
    ])
  }),
  Object.freeze({
    version: '4',
    status: 'ACTIVE',
    title: 'Tennis CLV data contract',
    scope: Object.freeze([
      'Verified CLV requires valid opening/closing odds and complete source metadata',
      'Closing timestamp must be after opening and not after match start',
      'Closing selection and market fingerprints are persisted for audit',
      'Totals require consistent point line',
      'Historical inconsistencies are reported without automatic backfill'
    ])
  }),
  Object.freeze({
    version: '5',
    status: 'ACTIVE',
    title: 'Tennis settlement evidence contract and runtime observability',
    scope: Object.freeze([
      'Automatic settlement requires VERIFIED or VOID evidence contract state',
      'Weak web and legacy cache results remain PROPOSED and cannot close a bet automatically',
      'Settlement evidence hash, source event id, winner, score and timestamps are persisted',
      'Structured Node JSONL diagnostics record operation id and crash phase',
      'Dashboard exposes readable frontend runtime diagnostics without secrets'
    ])
  }),
  Object.freeze({
    version: '6',
    status: 'ACTIVE',
    title: 'Tennis calibration eligibility ledger and shadow evaluation',
    scope: Object.freeze([
      'Separate eligibility ledger classifies certified and legacy Tennis records without rewriting source bets',
      'Brier, log loss, ECE, ROI and CLV are computed only on contract-eligible rows',
      'Calibration readiness is recommendation-only and never changes probabilities, gate or stake',
      'Read-only readiness endpoint reports excluded rows, stale ledger and segment metrics',
      'Frontend shows calibration readiness and routes failures to Patch 5 runtime diagnostics'
    ])
  }),
  Object.freeze({
    version: '7',
    status: 'ACTIVE',
    title: 'Immutable prediction snapshots and forward certification',
    scope: Object.freeze([
      'Every new Tennis prediction is persisted together with an immutable pre-match snapshot in one transaction',
      'Updates append market/model/decision revisions without overwriting the original prediction anchor',
      'Post-start or incomplete snapshots remain auditable but are excluded from certified calibration',
      'Calibration eligibility uses prediction-time values from the immutable anchor instead of mutable source rows',
      'Read-only audit endpoints, frontend status and structured Node diagnostics expose snapshot and chain failures'
    ])
  }),
  Object.freeze({
    version: '8',
    status: 'ACTIVE',
    title: 'Forward lifecycle atomicity and drift watchdog',
    scope: Object.freeze([
      'Tennis CLV persistence and calibration-ledger refresh commit or roll back together',
      'Tennis settlement persistence and calibration-ledger refresh commit or roll back together',
      'Derived lifecycle health compares source contracts, immutable anchor and eligibility ledger',
      'Read-only watchdog endpoint and CLI audit expose missing or stale forward records with Operation ID',
      'Explicit reconciliation repairs only the derived eligibility ledger and never rewrites source bets or snapshots'
    ])
  }),
  Object.freeze({
    version: '9',
    status: 'ACTIVE',
    title: 'Forward cohort seal, temporal leakage guard and compact operations center',
    scope: Object.freeze([
      'Every valid original pre-match snapshot is assigned once to a deterministic development or holdout cohort',
      'Cohort membership and anchor identity are sealed against update or delete while maturity remains derived',
      'Temporal guards block closing odds after match start, settlement before match start and fingerprint mismatches',
      'Forward canary validates prediction, snapshot, CLV, settlement, cohort and rollback without permanent test rows',
      'Patch diagnostics are grouped in a compact accessible Tennis Operations Center that can collapse to an icon'
    ])
  }),
  Object.freeze({
    version: '10',
    status: 'ACTIVE',
    title: 'Separated quantitative quality gate and DeepScan performance-aligned fusion',
    scope: Object.freeze([
      'Base Quality is computed only from quantitative pre-match inputs before DeepScan',
      'DeepScan remains an independent information layer and is fused only in the final gate',
      'Technical Edge alone no longer receives a positive operational label without exceptional independent evidence',
      'Model Risk plus a strong base becomes Watchlist Micro rather than remaining displayed as Soft Block',
      'Stake authority is explicit: zero, fixed EUR 2 micro or conservative bankroll percentage cap',
      'Dashboard reports final operational quality while preserving the base and DeepScan decisions separately'
    ])
  }),
  Object.freeze({
    version: '11',
    status: 'ACTIVE',
    title: 'Forward capture SLA, quality-decision observability and secure support export',
    scope: Object.freeze([
      'Read-only SLA monitor verifies prediction snapshot, cohort seal, CLV, settlement and eligibility timing',
      'Quality Gate V2 decision and stake coherence are checked without using current result or current CLV',
      'NO_FORWARD_DATA is informational until the first real Patch 10 prediction is persisted',
      'Operations Center adds one compact forward-capture panel and preserves all previous backend/UI links',
      'Safe support export excludes credentials, raw logs, node_modules, backups and patch packages and performs a secret scan'
    ])
  }),
  Object.freeze({
    version: '12',
    status: 'ACTIVE',
    title: 'As-of-safe player evidence, matchup intelligence and challenger shadow model',
    scope: Object.freeze([
      'Local structured player data is loaded synchronously, eliminating the prior asynchronous initialization race',
      'Every player feature and matchup uses only observations strictly before the prediction timestamp',
      'Immutable evidence, matchup and challenger snapshots are persisted atomically with each new Tennis prediction',
      'The production probability benefits only from the corrected local as-of-safe legacy adapter; the new challenger remains shadow-only',
      'DeepScan remains an independent qualitative layer and the challenger has no gate or stake authority',
      'The compact Operations Center exposes data coverage, freshness, matchup advantage, uncertainty and production/challenger comparison'
    ])
  }),
  Object.freeze({
    version: '13',
    status: 'ACTIVE',
    title: 'Historical DeepScan × Quality win-rate evidence and program progression guard',
    scope: Object.freeze([
      'AI analysis displays the empirical resolved Paper Trading win rate for the exact DeepScan and final Quality combination',
      'The historical percentage is accompanied by sample size, Wilson interval, reliability and operational ROI context',
      'Historical evidence is calculated read-only and never changes production probability, DeepScan, Quality Gate or stake',
      'Each new resolved-combination snapshot is persisted with source boundary and evidence hash for reproducibility',
      'A read-only progression audit certifies registry, inventory, SQLite integrity, critical tables, triggers, routes and frontend copies',
      'The compact Operations Center exposes the historical matrix and general progression health without touching Soccer'
    ])
  }),
  Object.freeze({
    version: '14',
    status: 'ACTIVE',
    title: 'Verified player-data refresh, atomic last-known-good activation and freshness guard',
    scope: Object.freeze([
      'Current-season ATP, ATP qualifying/Challenger and WTA data can be refreshed only from exact allowlisted primary repository paths',
      'Downloads are staged, schema-validated, checked against row/date regressions and activated atomically',
      'A last-known-good backup is restored automatically when download, validation, activation or engine reload fails',
      'The player evidence engine reads refresh provenance and source tiers while preserving as-of temporal safety',
      'Automatic background refresh is best-effort and never blocks server startup; manual local-only refresh remains available',
      'The compact Operations Center exposes data age, source coverage, last refresh and refresh failures without changing model weights, DeepScan, Quality Gate or stake policy'
    ])
  }),
  Object.freeze({
    version: '15',
    status: 'ACTIVE',
    title: 'Information retrieval certification for DeepScan, AI analysis and Paper Trading',
    scope: Object.freeze([
      'DeepScan news/context retrieval, AI quantitative inputs and Paper Trading result sources are tested as separate channels',
      'Every new prediction receives an immutable source-coverage receipt inside the existing atomic prediction transaction',
      'DeepScan reports cache/RSS/H2H retrieval provenance without changing its independent qualitative decision',
      'Paper Trading reports the exact result sources used while weak web evidence remains PROPOSE_ONLY or contract-guarded',
      'Local and optional live probes expose source status, latency, coverage, freshness and hashes without revealing API keys',
      'The compact Operations Center and progression guard certify retrieval health without changing production probability, Quality Gate, stake or Soccer'
    ])
  }),
  Object.freeze({
    version: '16',
    status: 'ACTIVE',
    title: 'Historical TennisDB player-history ingestion, temporal safety and shadow validation',
    scope: Object.freeze([
      'XLSX is the canonical structured input; Excel HTML is a parity and hyperlink fallback while PDF remains audit-only',
      'ATP and WTA sections are normalized with locale repair, source hashes, player links and immutable provenance',
      'Each year header applies to following rows until the next year header; ATP and WTA 2026-2025-2024 order is preflight-certified',
      'Duplicate season sections and ambiguous provider identities are quarantined instead of being guessed or merged silently',
      'Current-season aggregates are usable only after the source snapshot and completed seasons only after season end',
      'Historical matchup validation is auxiliary shadow evidence and cannot change production probability, Quality Gate, DeepScan, stake or settlement',
      'Imported datasets and records are persisted immutably without historical bet backfill and without touching Soccer'
    ])
  }),
  Object.freeze({
    version: '17',
    status: 'ACTIVE',
    title: 'Historical validation performance ledger, as-of-safe benchmark and forward promotion guard',
    scope: Object.freeze([
      'Settled Tennis moneyline rows are evaluated against Patch 16 historical validation without rewriting source bets',
      'The retrospective benchmark uses only seasons temporally available before each match and is explicitly audit-only',
      'Forward evaluations use the immutable historical validation captured inside prediction-time matchup snapshots',
      'Brier score, log loss, signal accuracy, coverage, calibration buckets and agreement with production are measured separately',
      'Append-only audit runs and evaluations are protected by immutable SQLite triggers',
      'Automatic promotion is impossible; minimum forward thresholds only unlock manual review in a future separate patch',
      'DeepScan, production probability, Quality Gate, stake, settlement, CLV, Soccer and historical bet rows remain unchanged'
    ])
  }),
  Object.freeze({
    version: '18',
    status: 'ACTIVE',
    title: 'Temporal cross-fitted statistical challenger, paired bootstrap stability and cohort guard',
    scope: Object.freeze([
      'Patch 17 retrospective evaluations are ordered chronologically and split into a warm-up block plus four out-of-sample folds',
      'For every fold the historical blend weight is selected only on strictly prior matches by minimum Brier score',
      'The historical contribution is conservatively capped at 50 percent and ties prefer the lower weight',
      'Out-of-sample Brier, log loss, accuracy and paired improvement are measured against production and raw historical probabilities',
      'Deterministic paired bootstrap intervals quantify uncertainty overall and separately for ATP and WTA cohorts',
      'Mixed cohort evidence blocks any production review even when the aggregate interval is positive',
      'The challenger remains shadow-only and cannot change production probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer or historical bets'
    ])
  }),
  Object.freeze({
    version: '19',
    status: 'ACTIVE',
    title: 'Professional Tennis statistical ensemble, tournament-stage degradation guard and best-available forecast',
    scope: Object.freeze([
      'Markov models Tennis at point, game, set and match levels with Beta posterior uncertainty and deterministic seeded simulation',
      'Monte Carlo delegates to the point-level Markov chain when service inputs exist and declares an explicit low-confidence fallback otherwise',
      'Elo combines overall and surface ratings while player evidence retains round history and late-round performance versus expectation',
      'Quarterfinal, semifinal and final pressure is integrated as a capped soft adjustment and can never hard-exclude a forecast',
      'Recent accuracy and Brier degradation shrinks extreme probabilities and confidence without suppressing the best available side',
      'Every evaluated match returns a best-available forecast with confidence, uncertainty and engine-disagreement diagnostics',
      'The ensemble has AI-analysis recommendation authority only and cannot mutate production probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer or historical bets'
    ])
  }),
  Object.freeze({
    version: '20',
    status: 'ACTIVE',
    title: 'Resilient player-data refresh, source diagnostics and health semantics',
    scope: Object.freeze([
      'Player data downloads use bounded retry, deterministic backoff and allowlisted GitHub transports',
      'Every HTTP or network failure records source id, URL, attempt number, response status and safe response headers',
      'A local-only source probe verifies ATP main, ATP qualifying/Challenger and WTA main without activating files',
      'Failed refreshes preserve the complete last-known-good dataset and are reported as degraded warnings when local data remains certified',
      'The operations UI distinguishes expected disabled auto-apply policy from a real error and displays source diagnostics',
      'No probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer or historical bet authority is introduced'
    ])
  }),
  Object.freeze({
    version: '21',
    status: 'ACTIVE',
    title: 'Cost-aware multi-provider player-data registry and zero-key-first atomic refresh',
    scope: Object.freeze([
      'A provider registry ranks local canonical imports, free bulk files, manual Tennis-Data imports, optional paid API fallback and last-known-good by cost and trust',
      'TennisMyLife bulk CSV is the default zero-key ATP source for main tour, Challenger and qualifying data',
      'WTA remains on a complete local bundle unless a validated manual import or explicitly enabled optional API supplies a newer certified candidate',
      'Optional API Tennis access is disabled by default, reads its key only from the environment, never persists or exposes it and enforces a daily request budget',
      'Provider cache, conditional requests, one shared fixtures call and circuit-safe fallbacks minimize network and paid API consumption',
      'All three target files are assembled as one validated mixed-provenance bundle and activated atomically; missing targets fall back to last-known-good rather than being excluded',
      'Production probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer and historical bet rows remain unchanged'
    ])
  }),
  Object.freeze({
    version: '22',
    status: 'ACTIVE',
    title: 'Tour-aware source freshness and player-activity evidence guard',
    scope: Object.freeze([
      'ATP main, ATP qualifying/Challenger and WTA main freshness are evaluated independently so one current circuit cannot mask a stale one',
      'Player inactivity and rest days remain an analytical activity signal and are no longer used as a proxy for source-dataset freshness',
      'Player evidence persists source target, provider, source freshness, activity status and their separate confidence penalties',
      'Matchup and challenger snapshots preserve the same separation in immutable forward-only records without historical backfill',
      'The operations center exposes a read-only tour-data readiness panel and explicit NO_FORWARD_SAMPLE status',
      'Program progression validates tour-aware freshness, UI/backend linkage, schema and absence of automatic production promotion',
      'Production probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer and historical bet rows remain unchanged'
    ])
  }),
  Object.freeze({
    version: '23',
    status: 'ACTIVE',
    title: 'Tour-aware information retrieval certification and zero-key health scoring alignment',
    scope: Object.freeze([
      'Information Retrieval resolves the ATP/WTA/Challenger target of the actual probe players before evaluating local player-data freshness',
      'A current ATP target can no longer certify WTA players when WTA_MAIN is stale; unresolved scope fails closed using the worst available target',
      'Probe players and fixed diagnostic canaries are reported separately and only probe players contribute to match-specific DeepScan coverage',
      'Optional paid Odds API configuration is excluded from health scoring when absent, preserving the Patch 21 zero-key-first cost policy',
      'RSS diagnostics distinguish HTTP success, RSS parsing, empty feeds, consent pages, response size and player relevance',
      'Prediction evidence receipts persist target-specific freshness without rewriting previous immutable Patch 15 receipts',
      'Production probability, DeepScan decisions, Quality Gate, stake, settlement, CLV, Soccer and historical bet rows remain unchanged'
    ])
  }),
  Object.freeze({
    version: '24',
    status: 'ACTIVE',
    title: 'Forward sample intake assurance and atomic evidence postconditions',
    scope: Object.freeze([
      'The next real pre-match Tennis prediction is monitored as a forward-only intake event without historical backfill',
      'Atomic persistence verifies source row, immutable snapshot, eligibility ledger, player evidence pair, matchup, challenger and prediction receipt before commit',
      'A valid calibration anchor additionally requires a sealed forward cohort member; structural gaps roll back the new prediction instead of silently losing evidence',
      'Read-only readiness reports exact sample progress, missing capabilities, structural coverage and the next operational action',
      'Failure diagnostics identify the actual persistence stage rather than attributing every failure to player matchup intelligence',
      'No retrospective row is promoted and no production probability, DeepScan, Quality Gate, stake, settlement, CLV or Soccer authority is introduced'
    ])
  }),
  Object.freeze({
    version: '25',
    status: 'ACTIVE',
    title: 'Runtime health truth, persistent exact scheduler and frontend coherency',
    scope: Object.freeze([
      'The operations badge is resolved dynamically from the active Tennis patch registry instead of a stale HTML constant',
      'Overall readiness distinguishes ready for first match, ready with warnings and critical not-ready states from calibration sample readiness',
      'The compact operations summary uses canonical error and warning counts without double-counting the same condition across panels',
      'Frontend cache coherency is tied to Patch 25 so a restarted server cannot continue showing an older app.js bundle',
      'Interval-hours scheduling uses a persisted nextRunAt timer with exact elapsed-hour cadence, restart recovery and a single-flight overlap lock instead of cron */N',
      'Server Core, Tennis Engine and Patch Registry versions are exposed as separate runtime identities',
      'A rollback-only first-match canary certifies the complete Patch 24 evidence chain without requiring a live tournament',
      'Production probability, DeepScan decisions, Quality Gate, stake, settlement, CLV, historical rows and Soccer remain unchanged'
    ])
  }),
  Object.freeze({
    version: '26',
    status: 'ACTIVE',
    title: 'Canonical Player Evidence Bridge and WTA current profile recovery',
    scope: Object.freeze([
      'Canonical identity resolution safely removes generational suffixes only when the resulting player is unique',
      'TennisDB XLSX player profiles are bridged into DeepScan identity, ranking, Elo, service-return and display context without production authority',
      'WTA current ranking, Elo, win-loss and schedule-strength profiles can supplement stale match-level evidence while technical freshness remains explicit',
      'Rank 500 and dominance-ratio 1.00 placeholders are removed; unavailable metrics remain N/D',
      'Canonical evidence is persisted for new DeepScan rows and exposed through read-only health and matchup endpoints',
      'Program progression accepts structurally healthy forward-sample capture and no longer reports a false critical first-match failure',
      'Production probability, Quality Gate, stake, settlement, CLV, historical rows and Soccer remain unchanged'
    ])
  }),
  Object.freeze({
    version: '27',
    status: 'ACTIVE',
    title: 'Explainable matchup labels, DeepScan RAM cache and cohort derived-state reconciliation',
    scope: Object.freeze([
      'Cryptic MATCHUP_ADVANTAGE_P1/P2, raw delta and SHADOW labels are replaced by player names and plain-language comparison against the main model',
      'The Tennis DeepScan queue removes the fixed four-second pause between matches while preserving sequential UI order and all operational authorities',
      'Bounded RAM result caches and in-flight request deduplication reduce repeated disk and network reads for player news and H2H context',
      'The H2H POST retry contract is corrected so contextual retrieval is attempted with the intended request configuration',
      'Forward cohort membership and seals remain immutable while only stale derived maturity states and state hashes are reconciled',
      'Runtime Diagnostics explains stale temporal states in operational language rather than reporting an unexplained cohort mismatch',
      'Production probability, Quality Gate, stake, settlement, CLV, historical rows, Soccer and Odds API usage remain unchanged'
    ])
  }),
  Object.freeze({
    version: '28',
    status: 'ACTIVE',
    title: 'Runtime health truth, evidence clarity and forward reschedule safety',
    scope: Object.freeze([
      'Runtime progression validates the active frontend cache marker dynamically and no longer reports Patch 27 as a false critical Patch 26 mismatch',
      'Canonical Player Evidence presence is separated from production sample sufficiency in the Analysis AI and Operations Center',
      'Settlement PROPOSED means evidence pending verification and no longer masquerades as temporal leakage or cohort quarantine',
      'Settlement diagnostics distinguish pending weak evidence, source conflicts, invalid contracts and manual review',
      'Forward maturity uses the current canonical rescheduled start while preserving the immutable original anchor and seal',
      'Superseded active PENDING revisions for the same provider event and market family are deactivated non-destructively',
      'Production probability, Quality Gate, stake, settlement authority, CLV, Soccer and Odds API usage remain unchanged'
    ])
  }),
  Object.freeze({
    version: '29',
    status: 'ACTIVE',
    title: 'Official settlement, prematch capture gate and component health semantic',
    scope: Object.freeze([
      'ATP/WTA official result evidence is resolved before local cache, weak web fallback and optional Odds API scores',
      'A signed official evidence seed enables deterministic offline recovery of eligible overdue Washington ATP settlements',
      'TennisMyLife and provider evidence fields are preserved end-to-end instead of being stripped before the Patch 5 contract',
      'Weak web evidence remains PROPOSED and retirement or walkover cases remain manual/bookmaker-policy sensitive',
      'Only active PENDING Tennis rows with complete post-match official evidence may become WON, LOST or VOID',
      'CLV missing remains separate and never blocks a verified result or gets reconstructed after the event',
      'Existing resolved rows, prediction probabilities, Quality Gate, stake authority, Soccer and Odds API usage remain unchanged',
      'Patch 29 R3 certifies Europe/Rome wall-clock match times before every future snapshot and blocks capture at or after start',
      'The Prematch Capture Gate executes inside the existing atomic transaction so a blocked capture rolls back the source row and every derived artifact',
      'Component Health Semantic separates REQUIRED_CORE/REQUIRED_CAPTURE failures from OPTIONAL_EVIDENCE degradation',
      'Unavailable optional providers generate READY_WITH_WARNINGS instead of a false NOT_READY_CRITICAL state',
      'R3 is additive and forward-only: no historical row backfill and no change to model probability, Quality Gate, stake, settlement, CLV or Soccer'
    ])
  }),
  Object.freeze({
    version: '30',
    status: 'ACTIVE',
    title: 'Core hygiene, executable script contracts and route dependency health',
    scope: Object.freeze([
      'Every package.json Node and Jest file target is present and every npm run reference resolves to a declared script',
      'Legacy Tennis pending-consistency and Step49C repair utilities are restored as preview-first tools with explicit apply mode',
      'The Patch 29 rollback command is routed through a stable revision-aware dispatcher and blocks unsafe out-of-order rollback while Patch 30 is active',
      'The duplicate getStep91PResolvedTennisHistory declaration is removed while preserving the effective Step92 runtime implementation',
      'A read-only Core Contract Audit maps Tennis routes to runtime module dependencies and reports broken relative imports or executable entrypoints',
      'Stale Runtime Health and progression-version checks are aligned to the active Patch 29 R3 and Patch 30 contracts',
      'No repair utility is executed during installation and no database row, probability, Quality Gate, stake, settlement, CLV, Soccer logic or Odds API usage is changed'
    ])
  }),
  Object.freeze({
    version: '31',
    status: 'ACTIVE',
    title: 'Secrets, environment-only credentials and reproducible safe release hardening',
    scope: Object.freeze([
      'Telegram bot credentials are migrated to the root environment file and ignored if found in JSON configuration or UI payloads',
      'A previously persisted Telegram credential is placed in rotation-required state and outbound notifications remain blocked until replacement is confirmed',
      'Credential values are never returned by health endpoints, installer output, audit reports or release manifests',
      'A read-only secret persistence audit scans distributable surfaces while allowing local environment files as the only credential store',
      'The safe release builder excludes databases, backups, runtime logs, environment files, archives and executable binaries and enforces a 150 MiB source-size guard',
      'Release artifacts include a checksum manifest and fail closed when a non-fixture secret pattern is detected',
      'Historical patch backups are not mutated; exposed credentials must be revoked so copies retained for rollback become unusable',
      'No database schema, historical row, model probability, Quality Gate, stake, settlement, CLV, Soccer logic or Odds API usage is changed'
    ])
  }),
  Object.freeze({
    version: '32',
    status: 'ACTIVE',
    title: 'Rejected capture observability, append-only clock drift ledger and provider timing health',
    scope: Object.freeze([
      'Every Prematch Capture Gate rejection is recorded only after the prediction transaction has rolled back, preserving the no-save guarantee',
      'A dedicated append-only ledger stores reason family, parse modes, lead time, provider identity and a tamper-evident event hash chain',
      'Clock diagnostics compare local capture time with bounded provider reference timestamps without adding network calls or external time APIs',
      'Boundary events and possible false rejections are flagged for review but never reactivate, persist or promote the blocked prediction automatically',
      'Read-only provider metrics expose unresolved event times, at-or-after-start blocks, clock drift suspects and recent rejected attempts',
      'The migration is additive and forward-only: the new ledger starts empty and no historical prediction or rejected attempt is reconstructed',
      'No production probability, DeepScan, Quality Gate, stake, settlement, CLV, Soccer logic or Odds API usage is changed'
    ])
  }),
  Object.freeze({
    version: '33',
    status: 'ACTIVE',
    title: 'Canonical event time contract, DST-safe provenance and provider time quality',
    scope: Object.freeze([
      'Every future Tennis capture resolves event time through an explicit source, timezone and authority contract before the Prematch Capture Gate',
      'Explicit UTC or offset timestamps, official schedules, provider schedules and local Europe/Rome wall clocks are kept as separate evidence candidates',
      'DST fallback ambiguity and spring-forward nonexistent local times are blocked instead of being silently mapped to an arbitrary instant',
      'Material provider conflicts use the earliest credible timestamp for capture safety while preserving the highest-authority canonical timestamp for audit',
      'Accepted and rejected observations are written to an append-only per-event revision ledger with reschedule direction and tamper-evident hash chains',
      'Provider timing quality is exposed read-only and never changes probability, DeepScan, Quality Gate, stake, settlement or CLV',
      'The migration is additive and forward-only with no historical time reconstruction or business-row backfill'
    ])
  }),
  Object.freeze({
    version: '34',
    status: 'ACTIVE',
    title: 'Official schedule authority plus signed settlement truth, immutable snapshot authority and diagnostic semantics',
    scope: Object.freeze([
      'Future Tennis captures resolve external schedule status through an explicit provider authority registry before commit',
      'SCHEDULED, DELAYED, POSTPONED, CANCELLED, SUSPENDED, RESUMED, STARTED and COMPLETED states are normalized without deriving settlement',
      'Credible terminal or suspended states block capture while missing status evidence remains forward-compatible as an audited review state',
      'Every accepted or rejected schedule observation is stored in an append-only per-event receipt ledger with transition direction and a tamper-evident hash chain',
      'A capture token is checked again before commit to detect schedule revision races inside the persistence lifecycle',
      'Provider schedule quality and reschedule metrics are exposed read-only and have no authority over probability, DeepScan, Quality Gate, stake, settlement or CLV',
      'The schedule migration remains additive and forward-only; Patch 34 R4 applies a narrowly scoped signed-result repair to five completed rows',
      'Settlement outcome and visible prediction truth are derived from the immutable calibration anchor, never from mutable post-capture analysis',
      'Retirements and suspended matches remain PENDING with explicit lifecycle reasons and no automatic bookmaker-rule inference',
      'Runtime diagnostics distinguish tail health from mature settlement debt, and AI reliability is labelled as evidence solidity rather than win probability'
    ])
  }),
  Object.freeze({
    version: '35',
    status: 'ACTIVE',
    title: 'Active CLV sport discovery, provider error truth, final stake authority and small-sample guard',
    scope: Object.freeze([
      'Every Tennis CLV sport key is validated against the active zero-credit /v4/sports catalog before an odds endpoint can be requested',
      'Invalid inferred keys are replaced only by tour and tournament matches from the live catalog; unresolved keys fail closed without consuming an odds request',
      'Provider 404, UNKNOWN_SPORT, authentication, rate-limit, timeout and valid-empty responses remain distinct and cannot be reported as a successful empty market',
      'Catalog retrieval uses bounded TTL cache and single-flight deduplication and does not change model, Quality Gate, settlement or Soccer behavior',
      'A single downstream final stake authority is applied after Quality Gate and historical DS×Gate evidence; earlier Steps may propose but cannot persist the final amount',
      'Exact DS×Gate samples n<5, including n=0 and n=1 headline 100%, are paper-only and receive zero operational stake',
      'Samples 5-29 are capped to micro stake while samples >=30 may preserve the Quality Gate proposal subject to existing hard vetoes and watchlist caps',
      'Current PENDING Tennis rows are reconciled additively with an append-only decision ledger; resolved history, probabilities, DeepScan labels, settlement and CLV values are not rewritten'
    ])
  }),
  Object.freeze({
    version: '36',
    status: 'ACTIVE',
    title: 'WTA zero-key provider recovery, tour-segmented drift authority and freshness circuit breaker',
    scope: Object.freeze([
      'Jeff Sackmann WTA yearly data is restored as an allowlisted zero-key candidate with CSV validation, conditional cache and last-known-good fallback',
      'Remote WTA data can activate only when schema, invalid-rate, row-count and latest-date regression checks pass; failed downloads never replace the active dataset',
      'Retrospective and FORWARD_CERTIFIED performance channels are measured separately by ATP, WTA and overall cohort',
      'Retrospective degradation may lower confidence and raise diagnostics but cannot mutate forecast probability',
      'Probability shrink requires mature FORWARD_CERTIFIED evidence and remains disabled on the current 19-row forward sample',
      'The final risk authority preserves Patch 35 small-sample protection and forces WTA stake to zero while match-level WTA data is stale or unavailable',
      'No historical prediction, settlement, CLV, DeepScan label, Quality Gate, Soccer row or npm dependency is rewritten'
    ])
  }),
  Object.freeze({
    version: '37',
    status: 'ACTIVE',
    title: 'External match intelligence, structured H2H truth, official ranking context and venue weather',
    scope: Object.freeze([
      'DuckDuckGo H2H snippets are removed from probability adjustment and replaced by exact local structured match history',
      'H2H influence uses a Bayesian prior, requires at least two meetings and is capped at plus or minus 2.5 percentage points inside DeepScan only',
      'ATP and WTA official rankings are accessed through allowlisted HTTPS adapters with bounded cache, timeout and response-size limits',
      'Open-Meteo venue forecasts provide heat, humidity, rain and wind context for outdoor matches with required attribution',
      'Official rankings and weather may reduce confidence or raise risk but cannot increase stake, replace the model, override Quality Gate or settle a bet',
      'External intelligence receipts and challenger runs are append-only and have no automatic promotion authority',
      'Match Charting Project is registered but disabled by default because deployment use must respect its non-commercial share-alike licence',
      'No Soccer row, historical Tennis prediction, settlement, CLV value or npm dependency is rewritten'
    ])
  }),
  Object.freeze({
    version: '38',
    status: 'ACTIVE',
    title: 'Forward health semantic truth, canonical operational decision and verified external evidence integrity',
    scope: Object.freeze([
      'Expected historical temporal exclusions remain sealed and excluded without being reported as an active pipeline failure',
      'Prematch policy rejections are recorded as expected warnings rather than Node snapshot errors',
      'One canonical final action separates the DeepScan proposal, Quality Gate and downstream stake authority in API and UI',
      'Official ranking conflict penalties require a verified structured parser result and never arise from nearby arbitrary numbers',
      'External source completeness is derived from resolved evidence instead of being hard-coded complete',
      'External receipts and ranking/weather coverage are exposed read-only without rewriting historical predictions',
      'No probability, settlement, CLV, Soccer row or npm dependency is changed by the migration'
    ])
  }),
  Object.freeze({
    version: '39',
    status: 'ACTIVE',
    title: 'Priority probability calibration guard, CLV checkpoint coverage and evidence-first source governance',
    scope: Object.freeze([
      'Recent 30, 50 and 100-result calibration windows detect overconfidence by probability band without rewriting the raw model probability',
      'The final calibration guard may only reduce operational probability authority and stake; it can never increase either value',
      'CLV coverage uses append-only first-seen, T-24h, T-2h and T-20m checkpoints and never reconstructs missing historical closing odds',
      'External intelligence receipts are linked deterministically to their Tennis prediction rows and remain append-only',
      'A deterministic evidence verification agent enforces event identity, source provenance, abstention on ambiguity and no-source/no-claim semantics',
      'Official ranking penalties require complete verified parsing plus certified event identity; partial or unparsed rankings are display-only',
      'Canonical tournament-to-venue routing makes weather usable only when the venue is resolved, including ATP/WTA Canada rotation by year',
      'WTA zero-key refresh runs independently with schema validation, licence mode guard and last-known-good preservation',
      'The migration changes only two currently exposed overconfident micro stakes on the certified baseline; historical probabilities, settlement and Soccer remain unchanged'
    ])
  }),
  Object.freeze({
    version: '40',
    status: 'ACTIVE',
    title: 'Canonical DeepScan taxonomy, reporting scope truth, sample-aware H2H and separated ROI/CLV analytics',
    scope: Object.freeze([
      'One canonical DeepScan registry supplies stable internal codes and identical Italian display labels to Trading, Analisi AI, API, export and frontend',
      'Legacy emoji and underscore aliases remain readable but are normalized to RISCHIO MODELLO, EDGE TECNICO, VALUE CONFERMATO / MICRO, ALTO RISCHIO, WATCHLIST LOW EDGE, ATTENDI IN-PLAY or SENZA DEEPSCAN',
      'The Tennis history endpoint exposes full active/current history and a separate rolling last-200 view instead of labelling a moving window as Globali',
      'Runtime diagnostics and statistics exclude paper_result_active=0 duplicates and paper_result_conflict rows from active business counts',
      'Operational ROI, paper signal hit rate and theoretical one-unit flat ROI are separate metrics with explicit denominators',
      'CLV reports verified coverage and beaten rate separately; null or absent CLV values never enter the tracked denominator',
      'Calibration bands are visible by probability range with sample, hit rate, average probability, gap and Brier score',
      'H2H n=2-3 is capped at plus or minus 0.75pp, n=4-6 at 1.5pp and n>=7 at 2.5pp, with no stake authority',
      'CURRENT_BOOTSTRAP is displayed as STORICO ATTIVO CORRENTE rather than the generic NEW HISTORY label',
      'The migration is additive and audit-only: no prediction, probability, stake, settlement, CLV, Soccer row or npm dependency is rewritten'
    ])
  }),
  Object.freeze({
    version: '41',
    status: 'ACTIVE',
    title: 'Trading dashboard readability, horizontal performance matrices and responsive information hierarchy',
    scope: Object.freeze([
      'The Trading dashboard uses an explicit responsive grid hierarchy instead of four competing columns with large empty vertical areas',
      'DeepScan performance is rendered as one full-width horizontal comparison table with stable signal, operational, stake, profit, ROI and audit columns',
      'Final Quality Gate performance uses the same full-width schema and column order so DeepScan and Gate can be compared without visual translation',
      'The rolling last-200 scope is a single compact horizontal table including operational W/L, stake, profit, ROI, signal hit rate, flat ROI and verified CLV coverage',
      'Calibration bands and competition performance remain vertical tables placed side by side on desktop and stacked on smaller screens',
      'Repeated counterfactual warning boxes are replaced by compact audit and pending badges while denominator explanations remain visible once per table',
      'Horizontal overflow is keyboard-focusable and responsive; mobile screens stack sections without changing calculations or data authority',
      'This patch is frontend-only and does not change database rows, probabilities, DeepScan classification, Quality Gate, stake, settlement, CLV, Soccer or npm dependencies'
    ])
  }),
  Object.freeze({
    version: '42',
    status: 'ACTIVE',
    title: 'Icon-first collapsible Trading dashboard with persistent accessible disclosure controls',
    scope: Object.freeze([
      'Every Trading analytics section is collapsed by default into an icon, title, compact KPI chips and an explicit disclosure chevron',
      'Step54 Exposure Guard, full active history, rolling last-200, calibration, competition ROI, DeepScan, Quality Gate and AI probability bands expand independently',
      'Expand-all and collapse-all controls use accessible icon buttons with labels and keyboard navigation',
      'Open and closed states are stored locally in the browser only and never persisted to the betting database',
      'The Trading, base-chart and CSV controls are compact icon actions with tooltips and accessible names',
      'The existing Patch 40 and Patch 41 tables remain unchanged inside each disclosure panel',
      'Responsive summaries hide secondary KPI chips on narrow screens while keeping the title, icon and expansion control visible',
      'This patch is frontend-only and does not change database rows, probabilities, taxonomy, Quality Gate, stake, settlement, CLV, Soccer or npm dependencies'
    ])
  }),
  Object.freeze({
    version: '43',
    status: 'ACTIVE',
    title: 'Dynamic WTA source discovery, verified mirror recovery and authorized local import',
    scope: Object.freeze([
      'The WTA refresh no longer depends on one hard-coded raw URL and discovers the repository default branch and current season file through the GitHub API',
      'A separately registered Hugging Face archival mirror can provide the same Sackmann-format season file when the primary repository path is unavailable',
      'A user-authorized local TennisData.App CSV may be imported without browser automation, scraping, CAPTCHA bypass or hidden network requests',
      'Every candidate is normalized when required, schema-validated, freshness-compared and rejected on row-count or latest-date regression',
      'Activation is staged and atomic; any parser or player-evidence initialization failure restores the previous last-known-good file',
      'CC BY-NC-SA network sources are disabled automatically in commercial usage mode while local authorized imports and the existing last-known-good remain available',
      'The legacy Patch 39 WTA route remains compatible but delegates refresh authority to Patch 43 and its dynamic source policy',
      'Health, probe and refresh endpoints expose provider, freshness, diagnostics, licence and authority without changing probability, DeepScan, Quality Gate, stake or settlement',
      'No network call, data activation or database migration occurs during installation'
    ])
  }),
  Object.freeze({
    version: '44',
    status: 'ACTIVE',
    title: 'Atomic Trading dashboard DOM wrapping and forward completion guard',
    scope: Object.freeze([
      'Trading accordion wrappers are inserted using the original sibling anchor after the card is moved, eliminating the invalid replaceChild lifecycle',
      'The market-audit panel uses the same atomic insertion path and remains ordered before the Trading dashboard',
      'The enhancement is idempotent: repeated renders do not create nested or duplicate disclosure panels',
      'A non-authoritative UI error boundary prevents optional dashboard enhancement failures from aborting FORWARD_TRADING or Paper Trading completion',
      'A deterministic Node DOM lifecycle regression test reproduces the Patch 42 failure and certifies the repaired first and repeated render paths',
      'Public and backend frontend mirrors remain byte-identical and the cache revision is advanced to Patch 44',
      'The patch is frontend-only: no database row, probability, DeepScan label, Quality Gate, stake, settlement, CLV, WTA source policy, Soccer logic or npm dependency is changed'
    ])
  }),
  Object.freeze({
    version: '45',
    status: 'ACTIVE',
    title: 'CLV contract runtime binding, canonical metadata propagation and atomic lock recovery',
    scope: Object.freeze([
      'clvTracker imports the canonical Patch 4 contract builder and version explicitly, eliminating the runtime ReferenceError after a Vault or live closing odd is found',
      'A fail-fast module assertion verifies both CLV contract bindings during startup before any scheduled tracker cycle can run',
      'Vault opening and closing timestamps, source event identity and point line are propagated to the canonical CLV contract instead of being replaced by the processing time',
      'Live closing locks propagate the provider event id and actual capture timestamp to the same contract path',
      'Available but unverified closing evidence is persisted with explicit contract reason and never labelled as a verified CLV lock',
      'Tennis CLV persistence remains inside the Patch 8 atomic lifecycle transaction and rolls back together with derived eligibility on failure',
      'Deterministic runtime tests cover verified lock, unverified post-match evidence, transaction rollback and zero network calls',
      'Installation is code-only: it does not migrate the database, replay the 54 degraded records, change probability, Quality Gate, stake, settlement, WTA policy, Soccer logic or npm dependencies'
    ])
  }),
  Object.freeze({
    version: '46',
    status: 'ACTIVE',
    title: 'Stake authority semantic separation and final executable stake contract',
    scope: Object.freeze([
      'The diagnostic Tennis Prediction Index is labelled explicitly as display-only and can no longer be confused with an executable stake authority',
      'Model suggestion, Quality Gate proposal/cap, risk authority cap, calibration reduction and final executable stake are represented as separate contract stages',
      'Patch 46 is the only final executable stake authority; all legacy authorities remain upstream proposal or limiting guards',
      'The final executable stake can only remain unchanged or decrease through the authority chain and can never exceed the model suggestion or any intermediate cap',
      'Current semantic fields are persisted on the betting row while an append-only immutable snapshot stores the complete authority contract and hash',
      'The DeepScan API response, audit trail, runtime diagnostics, Trading table and stake cell expose the same final executable contract',
      'The migration is additive and preserves every probability, DeepScan class, Quality Gate decision, stake amount, settlement, CLV value, WTA policy, Soccer row and npm dependency'
    ])
  }),
  Object.freeze({
    version: '47',
    status: 'ACTIVE',
    title: 'CLV degraded ledger, idempotent evidence and terminal recovery states',
    scope: Object.freeze([
      'Every Tennis CLV record is assigned to a structured state: retry eligible, available unverified, verified, temporally irrecoverable, market irrecoverable, exhausted or manual review',
      'A canonical evidence key covers source, odds, timestamps, bookmaker, event and market fingerprints, side, line and contract outcome',
      'An unchanged evidence key produces no second row update, no duplicate CLV_LOCK lifecycle event and no false updated counter',
      'Historical evidence outside the recovery window reaches a terminal state and is excluded from five-minute rescans and API planning',
      'The append-only ledger records only new evidence or state transitions and is protected against update and delete',
      'Runtime and status endpoints expose new locks, unchanged evidence, verified, unverified, retry, irrecoverable and exhausted counts separately',
      'The migration is additive and does not rewrite closing odds, CLV values, probabilities, stake, settlement, WTA source policy, Soccer data or npm dependencies'
    ])
  }),
  Object.freeze({
    version: '48',
    status: 'ACTIVE',
    title: 'Operational authority alignment, forward reason taxonomy, atomic reconcile and canonical DeepScan truth',
    scope: Object.freeze([
      'Patch47 terminal CLV records are quarantined from active structural forward faults while remaining audit-visible',
      'Forward reasons are classified into structural integrity, decision contract, evidence overdue and expected policy exclusion without weakening integrity guards',
      'Patch46 canonical stake contracts supersede ambiguous legacy allow flags when checking stake coherence',
      'Every calibration-only stake realignment refreshes eligibility and cohort state atomically before verification',
      'Cohort temporal exclusions caused by irrecoverable CLV evidence no longer block the forward pipeline',
      'Calibration remains diagnostic until production readiness and can only retain a micro cap instead of forcing zero by itself',
      'WTA stale, hard quality vetoes and risk circuit breakers remain authoritative zero-stake guards',
      'CLV state summaries are mutually exclusive and missing closing odds are exposed as a derived metric',
      'Trading and AI analysis expose the persisted canonical DeepScan proposal and provenance for the same bet',
      'Pending ATP rows are re-evaluated without changing probability, odds, result, settlement or CLV values'
    ])
  }),
  Object.freeze({
    version: '49',
    status: 'ACTIVE',
    title: 'Cross-sport analysis memory, prediction-index outcome bands and AI reliability visibility',
    scope: Object.freeze([
      'Analisi AI Tennis and Calcio reuse the latest in-memory result for 180 seconds when request identity is unchanged',
      'A cache hit performs no analysis endpoint fetch and no DeepScan replay while preserving an explicit force-refresh control',
      'DeepScan UI state is retained in memory together with the analysis result and is restored on navigation return',
      'Analisi AI exposes an explicit AI reliability score distinct from probability and prediction index',
      'Trading exposes the same prediction index used in Analisi AI for both Tennis and Calcio',
      'Read-only WON/LOST performance is aggregated by fixed 10-point prediction-index bands for all signals and real-stake rows',
      'Prediction-index analytics use only persisted prematch features for scoring and outcomes only for retrospective aggregation',
      'Weak settlement evidence remains contract-guarded and cannot auto-settle or alter historical outcomes'
    ])
  }),
  Object.freeze({
    version: '50',
    status: 'ACTIVE',
    title: 'Technical health check semantic alignment and collapsible prediction-index band table',
    scope: Object.freeze([
      'Technical checks validate compatible version families and required runtime capabilities instead of obsolete exact-version strings',
      'Runtime diagnostics, Forward Lifecycle, Player Evidence, Program Progression Audit and Multi-provider Data remain ERROR only when missing or incompatible',
      'Every aligned check exposes actual version, capability status and semantic reason while operational WARN states remain separate from module activation',
      'The prediction-index WON/LOST band table provides an accessible expand/collapse control without re-fetching analytics',
      'Collapse state survives scope and competition re-rendering and resets only when a new sport view is loaded',
      'The patch is code-only and does not modify database rows, probabilities, odds, DeepScan decisions, stake, settlement or CLV'
    ])
  }),
  Object.freeze({
    version: '51',
    status: 'ACTIVE',
    title: 'Settlement exception queue, targeted official recovery and idempotent lifecycle notifications',
    scope: Object.freeze([
      'Weak settlement evidence and bookmaker-rule review are represented as separate persistent exception classes',
      'A stable evidence key suppresses repeated database writes, lifecycle transitions and frontend warnings when evidence is unchanged',
      'Only weak-source exceptions enter the targeted official-result recovery plan; bookmaker retirement rules remain manual',
      'An append-only event ledger records new, changed and resolved exception evidence without mutating historical events',
      'Certified settlement closes the active exception atomically while preserving result, probability, odds, CLV and stake authority contracts',
      'Patch 51 seeds the five current exceptions without generating runtime notifications or network calls'
    ])
  }),
  Object.freeze({
    version: '52',
    status: 'ACTIVE',
    title: 'WTA freshness recovery with truthful candidate/active dataset separation',
    revision: 'R2',
    scope: Object.freeze([
      'WTA recovery uses an ordered zero-key source chain with authorized local import, dynamic GitHub discovery, verified mirrors and last-known-good fallback',
      'Permanent HTTP 404/410 provider failures enter a 24-hour cooldown instead of being retried repeatedly by probes and schedulers',
      'Transient network failures use a shorter cooldown and remain distinguishable from missing resources, policy exclusions and stale data',
      'Every candidate is schema-validated, compared with the active dataset, staged and activated atomically with rollback to last-known-good',
      'Current WTA recovery remains shadow-only and cannot directly change probability, DeepScan authority, Quality Gate, stake or settlement',
      'Legacy Patch39/Patch43 refresh endpoints and CLIs delegate to the Patch52 recovery authority',
      'Information Retrieval tools accept both positional project roots and the standard --root argument',
      'Installation is offline and does not modify database rows or silently download external data',
      'Patch52 R2 separates selectedCandidate from activeDataset and keeps active as a compatibility alias of the active dataset only',
      'A stale mirror can no longer be reported as FRESH_CANDIDATE_AVAILABLE or as the active dataset when no activation succeeded',
      'Recent-attempt skips expose both the transport status and the preserved semantic status without changing data or authority'
    ])
  }),
  Object.freeze({
    version: '53',
    status: 'ACTIVE',
    title: 'CLV coverage authority and cross-sport sport-key resolution',
    revision: 'R1',
    scope: Object.freeze([
      'A single cross-sport resolver maps Tennis and Calcio rows to provider sport keys without changing probability, stake or settlement authority',
      'Calcio league aliases are normalized against the authoritative league configuration so Premier, Serie A, Serie B, La Liga, Ligue 1 and Bundesliga no longer appear as NON_DETERMINATO',
      'Tennis keys remain provisional until active-provider catalog validation and unresolved historical metadata is labelled explicitly instead of inventing a provider key',
      'CLV coverage reports verified closing evidence, available-unverified evidence, retry eligibility, terminal states and missing evidence separately for Tennis and Calcio',
      'Sport-key coverage is persisted as routing metadata only and never creates synthetic closing odds or retroactive CLV values',
      'The Step103 runtime audit, smart-fetch planner, CLV report and health endpoints expose the same resolution and coverage contract',
      'The migration is additive and preserves row counts, odds, probabilities, outcomes, profit, stake, CLV values, settlement and WTA recovery state'
    ])
  }),
  Object.freeze({
    version: '54',
    status: 'ACTIVE',
    title: 'Calcio registry, inventory and regression harmonization',
    revision: 'R1',
    scope: Object.freeze([
      'Calcio registry version 38 and the persistent Calcio inventory are reconciled into one semantic source-of-truth contract without creating a new forecasting authority',
      'All 38 active Calcio registry entries are mirrored in the inventory with unique version and patch identifiers and zero unregistered active patches',
      'The latest cross-sport Patch26FF/R1 verification is revision-aware and no longer fails solely because Tennis registry, package version or frontend cache-buster advanced',
      'Historical regression checks validate preserved capabilities and minimum compatible versions instead of obsolete exact snapshots',
      'Calcio scheduler remains disabled and Patch54 does not enable automatic analysis, DeepScan, stake execution or background settlement',
      'Package, health endpoint, frontend cache-buster and CLI verification expose the same harmonization contract',
      'Patch54 is code/config metadata only and does not modify database rows, probability, odds, CLV values, stake, settlement or WTA recovery state'
    ])
  }),
  Object.freeze({
    version: '55',
    status: 'ACTIVE',
    title: 'Statistical production readiness gate',
    revision: 'R1',
    scope: Object.freeze([
      'A read-only fail-closed cross-sport gate classifies statistical readiness without activating production, probability, stake, settlement or schedulers',
      'Tennis readiness requires mature forward-certified actionable evidence, stable Brier improvement, all-tour challenger stability, current WTA data, mature forward drift, verified CLV coverage and a minimum economic sample',
      'Calcio readiness combines historical walk-forward holdout quality with per-league sample sufficiency, current resolved paper outcomes, reliability validation, verified CLV coverage, routing coverage and economic evidence',
      'Historical or retrospective improvements cannot compensate for missing forward evidence and no aggregated metric may mask an under-sampled tour or league',
      'The gate can only return BLOCKED_STATISTICAL_READINESS or MANUAL_CANARY_REVIEW_ELIGIBLE; automatic production promotion remains impossible',
      'Downstream portfolio risk, security, scheduler state-machine and controlled-canary patches remain mandatory even after the statistical gate passes',
      'Patch55 is read-only over the betting database and performs no network calls or business-value mutations during installation'
    ])
  }),
  Object.freeze({
    version: '56',
    status: 'ACTIVE',
    title: 'Unified cross-sport portfolio risk authority',
    revision: 'R1',
    scope: Object.freeze([
      'Patch56 is the final real-money exposure authority across Tennis and Calcio while preserving existing Paper Trading stake and evidence accumulation',
      'Patch55 statistical readiness is fail-closed and cannot be bypassed by diversification, legacy portfolio scopes, model confidence or sport-specific stake authorities',
      'Real-money exposure is persisted separately from paper stake so blocked production readiness does not prevent forward economic evidence from maturing',
      'Cross-sport caps constrain total exposure to 5% of bankroll, each sport to 3%, each event to 1% and each single candidate to 1%, with no stake increase',
      'A statistically eligible sport still remains real-money blocked until Patch57 security, Patch58 scheduler state machine and Patch59 controlled canary authority are all certified',
      'The authority is integrated into Tennis DeepScan, Calcio operational projection and Calcio batch portfolio allocation without changing probability, odds, settlement or Paper Trading stake',
      'Patch56 installation is offline; its database migration is additive metadata/schema only and preserves all existing business values and row counts'
    ])
  }),
  Object.freeze({
    version: '57',
    status: 'ACTIVE',
    title: 'Production security and safe release authority',
    revision: 'R1',
    scope: Object.freeze([
      'Server exposure is local-first and binds to loopback by default; non-loopback binding requires explicit remote opt-in and a strong token',
      'Wildcard CORS is removed and replaced by same-origin or explicit-origin policy with no implicit trust-proxy widening',
      'Forwarded tunnel/API traffic is detected and blocked unless remote access is explicitly enabled and authenticated with a bearer or X-BettingApp token',
      'Security headers, CSP and in-memory rate limits protect API, mutation and sensitive route classes without changing business decisions',
      'Remote browser tokens are session-only and may be bootstrapped through a URL fragment that is removed before API requests',
      'Safe release generation uses a strict top-level allowlist and excludes databases, environment files, backups, logs, executables, archives and patch state',
      'Patch56 consumes Patch57 security readiness as one downstream requirement while Patch58 and Patch59 remain independently mandatory',
      'Patch57 is code/config hardening only: it does not modify database rows, probability, odds, Paper stake, CLV, settlement, scheduler configuration or real-money exposure'
    ])
  }),
  Object.freeze({
    version: '58',
    status: 'ACTIVE',
    title: 'Scheduler reliability and operational state machine',
    revision: 'R1',
    scope: Object.freeze([
      'Tennis and Calcio schedulers are governed by a persistent fail-closed operational state machine with explicit states, transition receipts, run ids and heartbeat observability',
      'Patch53 CLV routing metadata is reconciled idempotently before every managed scheduler cycle; incomplete reconciliation blocks that cycle without changing probability, Paper stake or settlement authority',
      'Single-flight file locks, stale-run recovery, heartbeat watchdogs, retry backoff and terminal/retryable failure classification prevent overlapping or silently abandoned automation runs',
      'The pre-Patch58 Tennis lastRunSuccess=false condition is preserved and classified as degraded historical evidence instead of being rewritten as success',
      'Calcio scheduler remains disabled during installation and global Background no longer implicitly enables it; sport-specific activation requires an explicit confirmation',
      'Patch56 consumes Patch58 only when the relevant sport reaches READY_FOR_CONTROLLED_CANARY_REVIEW; infrastructure installation alone can never authorize real-money exposure',
      'Patch57 production security remains mandatory and Patch59 controlled canary remains independently required',
      'Patch58 preserves Paper/Shadow evidence accumulation and cannot mutate probability, Quality Gate, settlement or automatically activate production'
    ])
  }),
  Object.freeze({
    version: TENNIS_CURRENT_PATCH_VERSION,
    status: 'ACTIVE',
    title: 'Controlled canary activation and final production certification',
    revision: 'R1',
    scope: Object.freeze([
      'Patch59 is the final fail-closed canary authority and never authorizes real-money exposure unless Patch55 statistical readiness, Patch57 security and Patch58 scheduler handoff are all simultaneously ready',
      'Installation never creates a canary authorization lease; current blocked upstream evidence remains blocked and real-money exposure remains zero',
      'Any future canary authorization requires an explicit operator confirmation, is sport-scoped, time-limited, evidence-bound and revocable by a kill switch',
      'Patch56 consumes Patch59 proof dynamically and remains the final stake cap authority; Patch59 cannot increase a proposed Paper stake or bypass portfolio limits',
      'Final certification reports WTA freshness, forward maturity, CLV, economic sample, scheduler state, settlement exceptions, release security and legacy regression health without fabricating readiness',
      'Patch59 repairs the Patch56 frontend future-compatibility audit so the active Patch58/59 frontend revision no longer creates a false regression failure',
      'Paper/Shadow operation continues while production remains blocked; no automatic activation, probability mutation, settlement mutation or scheduler enablement is performed'
    ])
  })

]);

const ACTIVE_PENDING_PIPELINE = Object.freeze({
  version: 'TENNIS_PATCH_1_PENDING_PIPELINE',
  phases: Object.freeze({
    PRE_LOOKUP: Object.freeze(['STEP98D']),
    UPSERT: Object.freeze(['STEP96D', 'STEP96E', 'STEP96F', 'STEP96F_DRIFT', 'STEP99', 'STEP101', 'STEP101E', 'STEP98D_FINAL']),
    INSERT: Object.freeze(['STEP92_CONFLICT', 'STEP54_EXPOSURE', 'STEP98D', 'STEP96F', 'STEP101', 'STEP101E', 'STEP98E_FINAL'])
  })
});

function parseLegacyStepNumber(value) {
  if (Number.isInteger(value)) return value;
  const match = String(value || '').toUpperCase().match(/STEP[\s_-]?(\d{1,3})/);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isInteger(step) ? step : null;
}

function getLegacyBaselineGroup(value) {
  const step = parseLegacyStepNumber(value);
  if (step === null) return null;
  return LEGACY_BASELINE_GROUPS.find(group => step >= group.minStep && step <= group.maxStep) || null;
}

function assertLegacyStepRegistered(value) {
  const step = parseLegacyStepNumber(value);
  const group = getLegacyBaselineGroup(step);
  if (step === null || !group) {
    throw new Error(`Legacy Tennis patch non registrata: ${String(value)}`);
  }
  return group;
}

function getTennisPatchStatus() {
  return {
    registryVersion: TENNIS_PATCH_REGISTRY_VERSION,
    legacyBaselineVersion: TENNIS_LEGACY_BASELINE_VERSION,
    currentPatchVersion: TENNIS_CURRENT_PATCH_VERSION,
    currentPatchStatus: 'ACTIVE',
    pendingPipelineVersion: ACTIVE_PENDING_PIPELINE.version,
    legacyGroups: LEGACY_BASELINE_GROUPS.map(group => ({ ...group })),
    activePendingPipeline: {
      version: ACTIVE_PENDING_PIPELINE.version,
      phases: Object.fromEntries(
        Object.entries(ACTIVE_PENDING_PIPELINE.phases).map(([phase, steps]) => [phase, [...steps]])
      )
    }
  };
}

module.exports = {
  TENNIS_LEGACY_BASELINE_VERSION,
  TENNIS_CURRENT_PATCH_VERSION,
  TENNIS_PATCH_REGISTRY_VERSION,
  LEGACY_BASELINE_GROUPS,
  PATCHES,
  ACTIVE_PENDING_PIPELINE,
  parseLegacyStepNumber,
  getLegacyBaselineGroup,
  assertLegacyStepRegistered,
  getTennisPatchStatus
};
