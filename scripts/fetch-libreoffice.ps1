[CmdletBinding()]
param(
  [string]$ManifestPath = (Join-Path $PSScriptRoot "..\resources\dependency-manifests\libreoffice-windows-x64.json"),
  [string]$OutputDirectory = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$cacheRoot = if ($env:WEKI_CACHE_ROOT) { [IO.Path]::GetFullPath($env:WEKI_CACHE_ROOT) } else { Join-Path ([IO.Path]::GetTempPath()) "WekiCache" }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $cacheRoot "dependency-artifacts" }
$manifest = Get-Content -LiteralPath (Resolve-Path -LiteralPath $ManifestPath) -Raw | ConvertFrom-Json
if (([Uri]$manifest.url).Scheme -ne "https") { throw "LibreOffice manifest must contain an HTTPS URL." }
if ([string]$manifest.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "LibreOffice manifest SHA-256 is invalid." }
$bundleName = [IO.Path]::GetFileName(([Uri]$manifest.url).AbsolutePath)
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$target = Join-Path $output $bundleName
if (Test-Path -LiteralPath $target -PathType Leaf) {
  $existingHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($existingHash -eq ([string]$manifest.sha256).ToLowerInvariant()) { [pscustomobject]@{ status = "already-verified"; path = $target; sha256 = $existingHash; version = $manifest.version } | ConvertTo-Json -Compress; exit 0 }
  if (-not $Force) { throw "Existing LibreOffice bundle hash mismatch. Use -Force to replace it." }
}
$temporary = "$target.$PID.download"
try {
  Invoke-WebRequest -Uri $manifest.url -OutFile $temporary -UseBasicParsing
  $actualHash = (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$manifest.sha256).ToLowerInvariant()) { throw "LibreOffice bundle hash mismatch: expected $($manifest.sha256), got $actualHash" }
  Move-Item -LiteralPath $temporary -Destination $target -Force:$Force
  [pscustomobject]@{ status = "downloaded"; path = $target; sha256 = $actualHash; version = $manifest.version } | ConvertTo-Json -Compress
}
finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
