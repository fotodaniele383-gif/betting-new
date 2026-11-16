@echo off
setlocal
cd /d "%~dp0.."
echo =====================================================
echo AUDIT16B - CALCIO ANALYSIS PERFORMANCE
echo VERIFY + REGRESSION + AUTO ROLLBACK
echo =====================================================
call "%~dp0"00_preflight.cmd
if errorlevel 1 goto :fail_pre
call "%~dp0"01_apply.cmd
if errorlevel 1 goto :fail_apply
call "%~dp0"02_verify.cmd
if errorlevel 1 goto :rollback
call "%~dp0"03_regression.cmd
if errorlevel 1 goto :rollback
echo.
echo =====================================================
echo AUDIT16B APPLICATA: PERFORMANCE CALCIO CACHE ATTIVA
echo Diagnostica read-only: AUDIT16B\05_benchmark.cmd
echo Backup rollback conservato in .audit_patches\AUDIT16B
echo =====================================================
exit /b 0
:rollback
echo AUDIT16B gate fallito. Avvio rollback automatico...
call "%~dp0"04_rollback.cmd
exit /b 1
:fail_pre
echo AUDIT16B preflight fallito. Nessuna modifica applicata.
exit /b 1
:fail_apply
echo AUDIT16B apply fallito. Rollback gestito internamente se necessario.
exit /b 1
