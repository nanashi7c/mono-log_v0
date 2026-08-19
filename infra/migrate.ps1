param(
  [switch]$RestoredSnapshot,
  [switch]$ListMigrations
)

# Apply Prisma migration SQL to the private RDS through EC2 and SSM.
# Fresh DB: apply every migration.
# Restored snapshot: skip the migrations already contained in the saved snapshot.
# Usage (from infra/): powershell -ExecutionPolicy Bypass -File migrate.ps1
# Snapshot restore:     powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot
# Preview only:         powershell -ExecutionPolicy Bypass -File migrate.ps1 -RestoredSnapshot -ListMigrations

$ErrorActionPreference = "Stop"
$aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$Region = "ap-northeast-1"
$Project = "mono-log"
$RepoRoot = Split-Path $PSScriptRoot -Parent
$MigrationsRoot = Join-Path $RepoRoot "prisma/migrations"
$SnapshotBaselineMigrations = @(
  "20260613000000_init",
  "20260613000100_seed"
)

function Assert-NativeCommand([string]$Description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed (exit code: $LASTEXITCODE)"
  }
}

$MigrationDirectories = @(Get-ChildItem -Path $MigrationsRoot -Directory | Sort-Object Name)
if ($MigrationDirectories.Count -eq 0) {
  throw "No Prisma migrations found in $MigrationsRoot"
}

foreach ($MigrationDirectory in $MigrationDirectories) {
  if ($MigrationDirectory.Name -notmatch '^[0-9A-Za-z_-]+$') {
    throw "Invalid migration directory name: $($MigrationDirectory.Name)"
  }
  if (-not (Test-Path (Join-Path $MigrationDirectory.FullName "migration.sql") -PathType Leaf)) {
    throw "migration.sql not found in $($MigrationDirectory.FullName)"
  }
}

if ($RestoredSnapshot) {
  foreach ($BaselineMigration in $SnapshotBaselineMigrations) {
    if ($BaselineMigration -notin $MigrationDirectories.Name) {
      throw "Snapshot baseline migration not found: $BaselineMigration"
    }
  }
  $SelectedMigrations = @($MigrationDirectories | Where-Object { $_.Name -notin $SnapshotBaselineMigrations })
  $Mode = "restored"
} else {
  $SelectedMigrations = $MigrationDirectories
  $Mode = "fresh"
}

if ($SelectedMigrations.Count -eq 0) {
  throw "No migrations selected for mode: $Mode"
}

Write-Host "Migration mode: $Mode"
Write-Host "Selected migrations:"
foreach ($Migration in $SelectedMigrations) {
  Write-Host "  $($Migration.Name)"
}

if ($ListMigrations) {
  return
}

$RunId = [Guid]::NewGuid().ToString("N")
$Prefix = "_deploy/migrations/$RunId"
$ManifestFile = Join-Path $env:TEMP "mono-log-migrations-$RunId.txt"
$ParametersFile = Join-Path $env:TEMP "mono-log-migrate-$RunId.json"
$Bucket = $null

try {
  $ManifestEntries = @($SelectedMigrations | ForEach-Object { "$($_.Name).sql" })
  Set-Content -Path $ManifestFile -Value $ManifestEntries -Encoding ascii

  $Bucket = (& $aws ssm get-parameter --region $Region --name "/$Project/s3/bucket" `
      --query "Parameter.Value" --output text)
  Assert-NativeCommand "get application bucket name"
  $Bucket = "$Bucket".Trim()
  if (-not $Bucket -or $Bucket -eq "None") {
    throw "application bucket not found in SSM"
  }

  Write-Host "== upload migration SQL to an isolated S3 prefix =="
  & $aws s3 cp $ManifestFile "s3://$Bucket/$Prefix/manifest.txt" --region $Region | Out-Null
  Assert-NativeCommand "upload migration manifest"

  foreach ($Migration in $SelectedMigrations) {
    $MigrationFile = Join-Path $Migration.FullName "migration.sql"
    & $aws s3 cp $MigrationFile "s3://$Bucket/$Prefix/$($Migration.Name).sql" `
        --region $Region | Out-Null
    Assert-NativeCommand "upload migration $($Migration.Name)"
  }

  Write-Host "== find EC2 instance =="
  $Instance = (& $aws ec2 describe-instances --region $Region `
      --filters "Name=tag:Project,Values=$Project" "Name=instance-state-name,Values=running" `
      --query "Reservations[0].Instances[0].InstanceId" --output text)
  Assert-NativeCommand "find running EC2 instance"
  $Instance = "$Instance".Trim()
  if (-not $Instance -or $Instance -eq "None") {
    throw "running EC2 not found (check terraform apply)"
  }
  Write-Host "instance: $Instance"

  # The single-quoted here-string preserves Bash variables for execution on EC2.
  $Bash = @'
set -euo pipefail
REGION=__REGION__
PROJECT=__PROJECT__
BUCKET=__BUCKET__
PREFIX=__PREFIX__
MODE=__MODE__
WORKDIR=/tmp/mono-log-migrate-__RUN_ID__

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

mkdir -p "$WORKDIR"
aws s3 cp "s3://$BUCKET/$PREFIX/" "$WORKDIR/" --recursive --region "$REGION"

HOST=$(aws ssm get-parameter --region "$REGION" --name "/$PROJECT/db/host" --query Parameter.Value --output text)
MPW=$(aws ssm get-parameter --region "$REGION" --name "/$PROJECT/db/password" --with-decryption --query Parameter.Value --output text)
APW=$(aws ssm get-parameter --region "$REGION" --name "/$PROJECT/db/app_password" --with-decryption --query Parameter.Value --output text)

BASE_SCHEMA_EXISTS=$(docker run --rm -e PGPASSWORD="$MPW" postgres:16 \
  psql -h "$HOST" -U monolog_admin -d monolog -Atqc \
  "select (to_regclass('public.users') is not null)::text;")

if [ "$MODE" = "fresh" ] && [ "$BASE_SCHEMA_EXISTS" != "false" ]; then
  echo "Fresh mode requires an empty database, but public.users already exists." >&2
  exit 1
fi
if [ "$MODE" = "restored" ] && [ "$BASE_SCHEMA_EXISTS" != "true" ]; then
  echo "Restored snapshot mode requires the baseline schema, but public.users is missing." >&2
  exit 1
fi

mapfile -t MIGRATIONS < "$WORKDIR/manifest.txt"
if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  echo "Migration manifest is empty." >&2
  exit 1
fi

MIGRATION_ARGS=()
for migration in "${MIGRATIONS[@]}"; do
  if [[ ! "$migration" =~ ^[0-9A-Za-z_-]+\.sql$ ]]; then
    echo "Invalid migration file name: $migration" >&2
    exit 1
  fi
  if [ ! -f "$WORKDIR/$migration" ]; then
    echo "Migration file not found: $migration" >&2
    exit 1
  fi
  MIGRATION_ARGS+=( -f "/m/$migration" )
done

cat > "$WORKDIR/set-app-password.sql" <<'SQL'
ALTER ROLE monolog_app WITH PASSWORD :'app_password';
SQL

docker run --rm -e PGPASSWORD="$MPW" -v "$WORKDIR:/m:ro" postgres:16 \
  psql -h "$HOST" -U monolog_admin -d monolog \
  -v ON_ERROR_STOP=1 -v app_password="$APW" --single-transaction \
  "${MIGRATION_ARGS[@]}" \
  -f /m/set-app-password.sql
'@
  $Bash = $Bash.Replace("__REGION__", $Region).
      Replace("__PROJECT__", $Project).
      Replace("__BUCKET__", $Bucket).
      Replace("__PREFIX__", $Prefix).
      Replace("__MODE__", $Mode).
      Replace("__RUN_ID__", $RunId)
  $Bash = $Bash -replace "`r`n", "`n"

  $ParametersJson = @{ commands = @($Bash) } | ConvertTo-Json -Compress
  Set-Content -Path $ParametersFile -Value $ParametersJson -Encoding ascii
  $ParametersUri = "file://" + ($ParametersFile -replace '\\', '/')

  Write-Host "== apply migrations on RDS from EC2 via SSM =="
  $CommandId = (& $aws ssm send-command --region $Region --instance-ids $Instance `
      --document-name "AWS-RunShellScript" --parameters $ParametersUri `
      --query "Command.CommandId" --output text)
  Assert-NativeCommand "start RDS migration"
  $CommandId = "$CommandId".Trim()
  Write-Host "SSM command id: $CommandId"

  $Invocation = $null
  $Deadline = (Get-Date).AddMinutes(10)
  $RunningStatuses = @("Pending", "InProgress", "Delayed")

  while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 5
    $InvocationJson = (& $aws ssm get-command-invocation --region $Region `
        --command-id $CommandId --instance-id $Instance --output json 2>$null)

    if ($LASTEXITCODE -ne 0) {
      continue
    }

    $Invocation = $InvocationJson | ConvertFrom-Json
    if ($Invocation.Status -notin $RunningStatuses) {
      break
    }
  }

  if (-not $Invocation -or $Invocation.Status -in $RunningStatuses) {
    throw "RDS migration timed out while waiting for the SSM command."
  }
  if ($Invocation.StandardOutputContent) {
    Write-Host $Invocation.StandardOutputContent.TrimEnd()
  }
  if ($Invocation.StandardErrorContent) {
    Write-Warning $Invocation.StandardErrorContent.TrimEnd()
  }
  if ($Invocation.Status -ne "Success") {
    throw "RDS migration failed (SSM status: $($Invocation.Status))."
  }

  Write-Host "== migrations completed successfully =="
} finally {
  if ($Bucket) {
    & $aws s3 rm "s3://$Bucket/$Prefix/" --recursive --region $Region 2>$null | Out-Null
  }
  Remove-Item $ManifestFile -ErrorAction SilentlyContinue
  Remove-Item $ParametersFile -ErrorAction SilentlyContinue
}
