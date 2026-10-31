$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot "iPhone-USB-Mirror.exe")) {
    # Script was copied next to the packaged executable.
    $ProjectRoot = $PSScriptRoot
}
elseif (Test-Path -LiteralPath (Join-Path $PSScriptRoot "iPhone-USB-Mirror\iPhone-USB-Mirror.exe")) {
    # Script is at the root of the unpacked Windows distribution.
    $ProjectRoot = Join-Path $PSScriptRoot "iPhone-USB-Mirror"
}
$ToolRoot = Join-Path $ProjectRoot "tools\libimobiledevice"
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("iphone-usb-mirror-" + [guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $ToolRoot | Out-Null
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

try {
    Write-Host "Downloading current libimobiledevice Windows tools..."
    $Release = Invoke-RestMethod -Headers @{ "User-Agent" = "iPhone-USB-Mirror" } `
        -Uri "https://api.github.com/repos/jrjr/libimobiledevice-windows/releases/latest"
    $Asset = $Release.assets | Where-Object {
        $_.name -match "(?i)(x64|win64|amd64)" -and $_.name -match "(?i)\.(zip|7z)$"
    } | Select-Object -First 1
    if (-not $Asset) {
        $Asset = $Release.assets | Where-Object { $_.name -match "(?i)\.zip$" } | Select-Object -First 1
    }
    if (-not $Asset) { throw "No suitable Windows ZIP was found in the latest release." }
    $Archive = Join-Path $TempRoot $Asset.name
    Invoke-WebRequest -Headers @{ "User-Agent" = "iPhone-USB-Mirror" } `
        -Uri $Asset.browser_download_url -OutFile $Archive
    if ($Archive.EndsWith(".7z")) {
        if (-not (Get-Command 7z -ErrorAction SilentlyContinue)) {
            throw "The release is 7z. Install 7-Zip or unpack it into tools\libimobiledevice."
        }
        & 7z x $Archive "-o$TempRoot\unpacked" -y | Out-Null
    } else {
        Expand-Archive -LiteralPath $Archive -DestinationPath (Join-Path $TempRoot "unpacked") -Force
    }
    Get-ChildItem -Path (Join-Path $TempRoot "unpacked") -File -Recurse | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $ToolRoot $_.Name) -Force
    }
    foreach ($Name in @("idevice_id.exe", "idevicepair.exe", "ideviceinfo.exe", "iproxy.exe")) {
        if (-not (Test-Path -LiteralPath (Join-Path $ToolRoot $Name))) {
            throw "$Name was not found in the downloaded archive."
        }
    }
    Write-Host "USB tools installed in $ToolRoot"
    Write-Host "Also install Apple Devices from Microsoft Store so Windows has Apple Mobile Device USB drivers."
}
finally {
    if (Test-Path -LiteralPath $TempRoot) {
        Remove-Item -LiteralPath $TempRoot -Recurse -Force
    }
}

