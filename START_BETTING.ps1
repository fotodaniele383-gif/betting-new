$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$securePath = Join-Path $PSScriptRoot '.SAFE13_ODDS_CRED_DPAPI.txt'
if (Test-Path -LiteralPath $securePath -PathType Leaf) {
  try {
    $blob=(Get-Content -LiteralPath $securePath -Raw -Encoding UTF8).Trim()
    $ss=ConvertTo-SecureString -String $blob -ErrorAction Stop
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss)
    try { $env:ODDS_API_KEYS=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($env:ODDS_API_KEYS) { Write-Host 'CREDENZIALI_DPAPI=CARICATE (valori non mostrati)' }
  } catch { Write-Warning 'CREDENZIALI_DPAPI_NON_DECIFRABILI: verifica il file .env originale; chiavi non stampate' }
}
try { & node (Join-Path $PSScriptRoot 'START_BETTING.cjs') @args; $exitCode=$LASTEXITCODE }
finally { Remove-Item Env:\ODDS_API_KEYS -ErrorAction SilentlyContinue }
if ($exitCode -ne 0) { throw "AVVIO_NON_COMPLETATO_CODE=$exitCode" }
