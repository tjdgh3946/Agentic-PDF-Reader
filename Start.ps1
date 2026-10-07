$ErrorActionPreference = 'Stop'
$readerUrl = 'http://127.0.0.1:8767'
try { $readerHealth = (Invoke-WebRequest "$readerUrl/health" -UseBasicParsing -TimeoutSec 2).Content } catch { $readerHealth = '' }
if ($readerHealth -ne 'paper-reader-local-v2') {
    $readerNode = (Get-Command node -ErrorAction Stop).Source
    $readerProcess = Start-Process -FilePath $readerNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'server.mjs') + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'server.pid') -Value $readerProcess.Id
    $readerReady = $false
    for ($readerAttempt = 0; $readerAttempt -lt 20; $readerAttempt++) {
        Start-Sleep -Milliseconds 200
        try { if ((Invoke-WebRequest "$readerUrl/health" -UseBasicParsing -TimeoutSec 1).Content -eq 'paper-reader-local-v2') { $readerReady = $true; break } } catch {}
    }
    if (!$readerReady) { throw 'Cannot start Paper Reader. Check that port 8767 is available.' }
}
Start-Process $readerUrl

