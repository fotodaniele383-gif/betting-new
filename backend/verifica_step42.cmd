@echo off
cd /d "%~dp0.."

echo.
echo === VERIFICA FILE PRINCIPALI ===
if exist backend\tennisGateStep42.js echo OK backend\tennisGateStep42.js
if exist backend\tests\tennisGateHardOnlyStep42.test.js echo OK tennisGateHardOnlyStep42.test.js
if exist backend\tests\tennisMarketMixAndDeepScanStep42.test.js echo OK tennisMarketMixAndDeepScanStep42.test.js
if exist backend\server.tennis.js echo OK backend\server.tennis.js
if exist backend\tennisValueEvaluator.js echo OK backend\tennisValueEvaluator.js
if exist public\app.js echo OK public\app.js

echo.
echo === VERIFICA MARCATORI STEP42 IN public\app.js ===
findstr /N /C:"NON il data_quality tecnico" public\app.js
findstr /N /C:"VALUE CONFERMATO" public\app.js
findstr /N /C:"EDGE TECNICO" public\app.js
findstr /N /C:"WATCHLIST / LOW EDGE" public\app.js
findstr /N /C:"RISCHIO MODELLO" public\app.js
findstr /N /C:"ALTO RISCHIO" public\app.js

echo.
echo === TEST JEST STEP42 ===
npx.cmd jest backend/tests/tennisGateHardOnlyStep42.test.js backend/tests/tennisMarketMixAndDeepScanStep42.test.js backend/tests/tennisDeepScanContextGateAudit.test.js backend/tests/tennisKellyStakePolicy.test.js backend/tests/app.paperPerformanceBreakdown.ui.test.js backend/tests/ui.graphics.v14_7.test.js backend/tests/ui.background.bankroll.test.js --runInBand

echo.
pause