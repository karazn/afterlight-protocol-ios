$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $ProjectRoot ".venv-build"
if (-not (Test-Path -LiteralPath (Join-Path $Venv "Scripts\python.exe"))) {
    python -m venv $Venv
}
$Python = Join-Path $Venv "Scripts\python.exe"
& $Python -m pip install --upgrade pip
& $Python -m pip install $ProjectRoot pyinstaller
Push-Location $ProjectRoot
try {
    & $Python -m PyInstaller packaging\iphone-usb-mirror.spec --noconfirm --clean
} finally {
    Pop-Location
}
Write-Host "Built: $ProjectRoot\dist\iPhone-USB-Mirror\iPhone-USB-Mirror.exe"

