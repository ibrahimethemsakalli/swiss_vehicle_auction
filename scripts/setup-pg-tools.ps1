# Optional Windows x64 tools; no server installation or system PATH change.
$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') { throw 'Windows x64 only; otherwise set PG_BIN to your PostgreSQL client-tools directory.' }
$toolsRoot = Join-Path (Get-Location) '.local/pg-tools'
New-Item -ItemType Directory -Force -Path $toolsRoot | Out-Null
$archive = Join-Path $toolsRoot 'postgresql-18.6-5-windows-x64-binaries.zip'
$download = 'https://get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64-binaries.zip'
$checksumText = (Invoke-WebRequest -UseBasicParsing -Uri "$download.sha256").Content
if ($checksumText -is [byte[]]) { $checksumText = [Text.Encoding]::UTF8.GetString($checksumText) }
$expected = [regex]::Match([string]$checksumText, '[a-fA-F0-9]{64}').Value.ToLowerInvariant()
if ($expected.Length -ne 64) { throw 'Official checksum unavailable' }
if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Archive checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($archive)
try {
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -match '^pgsql/bin/[^/]+\.(exe|dll)$') {
      $destination = Join-Path $toolsRoot $entry.Name
      if (-not (Test-Path -LiteralPath $destination)) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination) }
    }
  }
} finally { $zip.Dispose() }
& (Join-Path $toolsRoot 'pg_dump.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'pg_dump could not start' }
& (Join-Path $toolsRoot 'pg_restore.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'pg_restore could not start' }
