param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist\firefox')
)

$ErrorActionPreference = 'Stop'

$files = @(
  'background.js',
  'content.js',
  'popup.css',
  'popup-data.js',
  'popup.html',
  'popup.js',
  'regions.js',
  'icon-16.png',
  'icon-32.png',
  'icon-48.png',
  'icon-96.png',
  'icon-128.png'
)

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($file in $files) {
  Copy-Item -Path (Join-Path $PSScriptRoot $file) -Destination $OutputDirectory -Force
}
Copy-Item -Path (Join-Path $PSScriptRoot 'manifest.firefox.json') `
  -Destination (Join-Path $OutputDirectory 'manifest.json') -Force

Write-Output "Firefox build created at $OutputDirectory"
