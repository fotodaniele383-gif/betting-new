@echo off
setlocal
echo =====================================================
echo AUDIT12 - SETTLEMENT RESOLUTION PROOF + REGRESSION
echo =====================================================
echo.

call "%~dp000_preflight.cmd"
if errorlevel 1 (
  echo.
  echo STOP AUDIT12: preflight fallito. Nessuna modifica applicata.
  exit /b 10
)

call "%~dp001_apply.cmd"
if errorlevel 1 (
  echo.
  echo STOP AUDIT12: apply fallito. Il motore apply tenta gia' il rollback interno.
  call "%~dp005_status.cmd"
  exit /b 20
)

call "%~dp002_verify.cmd"
if errorlevel 1 goto AUTO_ROLLBACK

call "%~dp003_regression.cmd"
if errorlevel 1 goto AUTO_ROLLBACK

echo.
echo =====================================================
echo AUDIT12 APPLICATA: RISOLUZIONE EXCEPTION FAIL-CLOSED
echo Tutte le suite baseline + AUDIT12 sono verdi.
echo Nessuna settlement exception esistente e' stata risolta dalla patch.
echo Backup rollback conservato in .audit_patches\AUDIT12
echo =====================================================
exit /b 0

:AUTO_ROLLBACK
echo.
echo =====================================================
echo GATE FALLITO - AVVIO ROLLBACK AUTOMATICO AUDIT12
echo =====================================================
call "%~dp004_rollback.cmd"
if errorlevel 1 (
  echo ERRORE CRITICO: rollback automatico non certificato.
  exit /b 99
)
echo Rollback completato e baseline post-AUDIT11 ripristinata.
exit /b 30
