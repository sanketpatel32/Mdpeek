# install.ps1 — mdpeek terminal installer
#
# One-liner usage (paste into PowerShell):
#   irm https://raw.githubusercontent.com/sanketpatel32/Mdpeek/main/install.ps1 | iex
#
# What it does:
#   1. Finds the latest mdpeek release on GitHub.
#   2. Downloads the NSIS setup.exe.
#   3. Runs it elevated (UAC prompt) — the GUI wizard then installs mdpeek
#      to C:\Program Files\mdpeek\.
#
# NOTE on `irm | iex`: when piped, this script runs in a child scope, so all
# variables are local and cleaned up automatically.

$ErrorActionPreference = 'Stop'

$repo = 'sanketpatel32/Mdpeek'
$apiUrl = "https://api.github.com/repos/$repo/releases/latest"

Write-Host 'mdpeek installer' -ForegroundColor Cyan
Write-Host 'Looking up the latest release...' -ForegroundColor DarkGray

# Fetch the latest release metadata.
$release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'mdpeek-installer' }
$version = $release.tag_name
Write-Host "Latest version: $version" -ForegroundColor Green

# Find the setup.exe asset.
$asset = $release.assets | Where-Object { $_.name -like '*-setup.exe' } | Select-Object -First 1
if (-not $asset) {
    throw "No setup.exe asset found in release $version."
}
$downloadUrl = $asset.browser_download_url

# Download to a temp file.
$tempFile = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $asset.name ..." -ForegroundColor DarkGray
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing

Write-Host 'Launching installer (you will get a UAC prompt — click Yes)...' -ForegroundColor Yellow

# Run elevated. The GUI wizard then takes over; -Wait blocks until it exits.
# Users see the standard install wizard (perMachine → installs to Program Files).
try {
    Start-Process -FilePath $tempFile -Verb RunAs -Wait
} finally {
    Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
}

# Confirm.
$installed = 'C:\Program Files\mdpeek\mdpeek.exe'
if (Test-Path $installed) {
    Write-Host ''
    Write-Host 'mdpeek installed successfully.' -ForegroundColor Green
    Write-Host "  Location: $installed"
    Write-Host '  Start it from the Start Menu, or double-click any .md file.'
} else {
    Write-Host ''
    Write-Host 'Installer finished but mdpeek.exe was not found at the expected path.' -ForegroundColor Red
    Write-Host 'Check that the wizard completed successfully.' -ForegroundColor Red
}
