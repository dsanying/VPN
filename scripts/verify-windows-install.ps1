$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows' -or $env:CI -ne 'true') {
  throw 'Installer acceptance runs only on the disposable Windows CI runner.'
}
$installers = @(Get-ChildItem 'dist-package' -Filter '*-win-x64-setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows installer.' }
$destination = Join-Path $env:RUNNER_TEMP 'ShadowVPN Custom Install'
if (Test-Path $destination) { throw 'Acceptance install directory must be new.' }
# NSIS requires /D to be the last argument; the space in the path exercises custom-directory handling.
$process = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', "/D=$destination") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "NSIS installation failed: $($process.ExitCode)" }
$executable = Join-Path $destination '暗影VPN.exe'
if (!(Test-Path $executable -PathType Leaf)) { throw 'Installer ignored the selected destination.' }
& node scripts/verify-desktop-installed.mjs --exe $executable
if ($LASTEXITCODE -ne 0) { throw 'Installed native application checks failed.' }
@{ destinationSelected = $true; installedExecutable = $true; checkedAt = (Get-Date).ToUniversalTime().ToString('o') } |
  ConvertTo-Json | Set-Content 'artifacts/windows-x64/custom-install.json' -Encoding utf8
