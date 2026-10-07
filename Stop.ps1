$ErrorActionPreference = 'Stop'
$readerPidFile = Join-Path $PSScriptRoot 'server.pid'
if (!(Test-Path -LiteralPath $readerPidFile)) { exit }
$readerPid = [int](Get-Content -LiteralPath $readerPidFile)
$readerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $readerPid"
$readerScript = Join-Path $PSScriptRoot 'server.mjs'
if ($readerProcess -and $readerProcess.Name -eq 'node.exe' -and $readerProcess.CommandLine.Contains('"' + $readerScript + '"')) {
    Stop-Process -Id $readerPid
    Remove-Item -LiteralPath $readerPidFile
}
