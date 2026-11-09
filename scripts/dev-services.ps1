param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("up", "down")]
  [string] $Action
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = Join-Path $RepoRoot ".env"
$ComposeFile = Join-Path $RepoRoot "infrastructure\docker\compose.yaml"

$NeedsEnv = -not (Test-Path -LiteralPath $EnvFile)
if (-not $NeedsEnv) {
  $NeedsEnv = -not (Select-String -LiteralPath $EnvFile -Pattern '^S3_SECRET_ACCESS_KEY=' -Quiet)
  if ($NeedsEnv) {
    throw "Existing .env needs the S3_* settings from .env.example. Update it manually; this script will not overwrite it."
  }
}

if ($NeedsEnv) {
  $Bytes = New-Object byte[] 32
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
  $PgPassword = [System.BitConverter]::ToString($Bytes).Replace("-", "")
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
  $S3Secret = [System.BitConverter]::ToString($Bytes).Replace("-", "")
  $Content = @"
APP_ENV=development
API_ADDR=127.0.0.1:8080
DATABASE_URL=postgres://pdv_dev:$PgPassword@127.0.0.1:5432/pdv?sslmode=disable
POSTGRES_USER=pdv_dev
POSTGRES_PASSWORD=$PgPassword
POSTGRES_DB=pdv
S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY_ID=pdv_local
S3_SECRET_ACCESS_KEY=$S3Secret
S3_BUCKET=pdv-encrypted-dev
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
WEB_ORIGIN=http://localhost:5173
ADMIN_ORIGIN=http://localhost:5174
API_ORIGIN=http://localhost:8080
LOG_LEVEL=info
"@
  Set-Content -LiteralPath $EnvFile -Value $Content -Encoding ascii
  Write-Host "Created ignored .env with random local-only service credentials."
}

Push-Location $RepoRoot
try {
  if ($Action -eq "up") {
    docker compose --env-file .env -f $ComposeFile up -d
  } else {
    docker compose --env-file .env -f $ComposeFile down
  }
  if ($LASTEXITCODE -ne 0) { throw "docker compose $Action failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
