# R12 MANUAL-ONLY CANDIDATE FETCH. Does not install or activate data; no DB writes.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $env:LOCALAPPDATA 'BettingApp_R12_CSV_CANDIDATI'
$dataset = 'https://huggingface.co/datasets/minmaxxxer/atp-wta-matches-with-odds/resolve/main/'
Write-Host 'Questo comando scarica solo copie CANDIDATE ATP/WTA 2026 nel tuo profilo.'
Write-Host 'La fonte si presenta come CC BY 4.0, ma provenienza e diritti derivati devono essere verificati.'
Write-Host 'NON modifica i CSV attivi, il DB, i gate, lo stake o il sistema di scommesse.'
$confirm = Read-Host 'Digita SCARICA_CANDIDATI per proseguire'
if ($confirm -cne 'SCARICA_CANDIDATI') { Write-Host 'R12_DOWNLOAD_ANNULLATO'; exit 2 }
New-Item -ItemType Directory -Path $dir -Force | Out-Null
foreach ($target in @('WTA_MAIN','ATP_MAIN')) {
    $name = if ($target -eq 'WTA_MAIN') { 'wta_matches_2026.csv' } else { 'atp_matches_2026.csv' }
    $url = $dataset + $name
    $temp = Join-Path $dir ($name + '.download')
    $final = Join-Path $dir $name
    try {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
        Invoke-WebRequest -Uri $url -OutFile $temp -MaximumRedirection 4 -TimeoutSec 90 -UseBasicParsing
        $size = (Get-Item -LiteralPath $temp).Length
        if ($size -lt 500 -or $size -gt 26214400) { throw 'CSV_SIZE_INVALID' }
        $first = Get-Content -LiteralPath $temp -TotalCount 1
        if ($first -notmatch 'tourney_date' -or $first -notmatch 'winner_name' -or $first -notmatch 'loser_name' -or $first -notmatch 'best_of') { throw 'NOT_CANONICAL_CSV' }
        $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $temp).Hash
        # Keep previous candidate immutable if different; do not replace silently.
        if (Test-Path -LiteralPath $final) {
            if ((Get-FileHash -Algorithm SHA256 -LiteralPath $final).Hash -ne $sha) {
                $archive = Join-Path $dir ($name + '.' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.previous')
                Move-Item -LiteralPath $final -Destination $archive
            } else { Remove-Item -LiteralPath $temp -Force; Write-Host "$target ALREADY_DOWNLOADED SHA256=$sha"; continue }
        }
        Move-Item -LiteralPath $temp -Destination $final
        Write-Host "R12_CANDIDATE_DOWNLOADED TARGET=$target CSV=$final SHA256=$sha SIZE=$size URL=$url"
        # DRY RUN only; the R11 validator checks freshness, row counts and anti-regression.
        & node (Join-Path $root 'addons\data-first-r11\tennis-intake.cjs') 'check' $root $target $final $url 'UNKNOWN_REVIEW_REQUIRED'
        if ($LASTEXITCODE -ne 0) { Write-Warning "R12_CANDIDATE_INVALID_OR_STALE=$target; NO ACTIVE DATA CHANGED" }
    } catch {
        Write-Warning "R12_CANDIDATE_DOWNLOAD_FAILED=$target $($_.Exception.Message)"
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
    }
}
Write-Host 'R12_CANDIDATES_ONLY. Non attivati. Verificare diritti e provenienza prima di R11_PREPARA_IMPORT_TENNIS.cmd.'
