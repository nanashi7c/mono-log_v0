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
  $Mode = "restored-snapshot"
} else {
  $SelectedMigrations = $MigrationDirectories
  $Mode = "automatic"
}

Write-Host "Migration mode: $Mode"
Write-Host "Candidate migrations:"
foreach ($Migration in $SelectedMigrations) {
  Write-Host "  $($Migration.Name)"
}

if ($ListMigrations) {
  return
}

$RunId = [Guid]::NewGuid().ToString("N")
$Prefix = "_deploy/migrations/$RunId"
$ManifestFile = Join-Path $env:TEMP "mono-log-migrations-$RunId.txt"
$BaselineManifestFile = Join-Path $env:TEMP "mono-log-migration-baseline-$RunId.txt"
$ParametersFile = Join-Path $env:TEMP "mono-log-migrate-$RunId.json"
$Bucket = $null

try {
  $ManifestEntries = @($SelectedMigrations | ForEach-Object { "$($_.Name).sql" })
  $ManifestContent = if ($ManifestEntries.Count -eq 0) { "" } else { ($ManifestEntries -join "`n") + "`n" }
  $BaselineContent = ($SnapshotBaselineMigrations -join "`n") + "`n"
  [IO.File]::WriteAllText($ManifestFile, $ManifestContent, [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($BaselineManifestFile, $BaselineContent, [Text.Encoding]::ASCII)

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
  & $aws s3 cp $BaselineManifestFile "s3://$Bucket/$Prefix/baseline.txt" --region $Region | Out-Null
  Assert-NativeCommand "upload snapshot baseline manifest"

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
MIGRATION_HISTORY_EXISTS=$(docker run --rm -e PGPASSWORD="$MPW" postgres:16 \
  psql -h "$HOST" -U monolog_admin -d monolog -Atqc \
  "select (to_regclass('app.schema_migrations') is not null)::text;")

if [ "$MODE" = "restored-snapshot" ] && [ "$BASE_SCHEMA_EXISTS" != "true" ]; then
  echo "Restored snapshot mode requires the baseline schema, but public.users is missing." >&2
  exit 1
fi
if [ "$MODE" = "automatic" ] && [ "$BASE_SCHEMA_EXISTS" = "true" ] && [ "$MIGRATION_HISTORY_EXISTS" != "true" ]; then
  echo "Existing schema has no migration history. Use -RestoredSnapshot only for the documented snapshot baseline." >&2
  exit 1
fi

mapfile -t MIGRATIONS < "$WORKDIR/manifest.txt"
mapfile -t BASELINE_MIGRATIONS < "$WORKDIR/baseline.txt"

MIGRATION_ARGS=()
APPLIED_MIGRATIONS=()
for migration in "${MIGRATIONS[@]}"; do
  migration=${migration%$'\r'}
  [ -z "$migration" ] && continue
  if [[ ! "$migration" =~ ^[0-9A-Za-z_-]+\.sql$ ]]; then
    echo "Invalid migration file name: $migration" >&2
    exit 1
  fi
  if [ ! -f "$WORKDIR/$migration" ]; then
    echo "Migration file not found: $migration" >&2
    exit 1
  fi
  migration_name=${migration%.sql}
  already_applied=false
  if [ "$MIGRATION_HISTORY_EXISTS" = "true" ]; then
    already_applied=$(docker run --rm -e PGPASSWORD="$MPW" postgres:16 \
      psql -h "$HOST" -U monolog_admin -d monolog -Atqc \
      "select exists(select 1 from app.schema_migrations where name = '$migration_name')::text;")
  fi
  if [ "$already_applied" != "true" ]; then
    MIGRATION_ARGS+=( -f "/m/$migration" )
    APPLIED_MIGRATIONS+=( "$migration_name" )
  fi
done

cat > "$WORKDIR/begin-migrations.sql" <<'SQL'
select pg_advisory_xact_lock(hashtext('mono-log-schema-migrations'));
SQL

cat > "$WORKDIR/finalize-migrations.sql" <<'SQL'
create table if not exists app.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

if [ "$MODE" = "restored-snapshot" ] && [ "$MIGRATION_HISTORY_EXISTS" != "true" ]; then
  for baseline_migration in "${BASELINE_MIGRATIONS[@]}"; do
    baseline_migration=${baseline_migration%$'\r'}
    if [[ ! "$baseline_migration" =~ ^[0-9A-Za-z_-]+$ ]]; then
      echo "Invalid baseline migration name: $baseline_migration" >&2
      exit 1
    fi
    printf "insert into app.schema_migrations (name) values ('%s') on conflict (name) do nothing;\n" \
      "$baseline_migration" >> "$WORKDIR/finalize-migrations.sql"
  done
fi

for applied_migration in "${APPLIED_MIGRATIONS[@]}"; do
  printf "insert into app.schema_migrations (name) values ('%s') on conflict (name) do nothing;\n" \
    "$applied_migration" >> "$WORKDIR/finalize-migrations.sql"
done

cat >> "$WORKDIR/finalize-migrations.sql" <<'SQL'
ALTER ROLE monolog_app WITH PASSWORD :'app_password';
SQL

docker run --rm -e PGPASSWORD="$MPW" -v "$WORKDIR:/m:ro" postgres:16 \
  psql -h "$HOST" -U monolog_admin -d monolog \
  -v ON_ERROR_STOP=1 -v app_password="$APW" --single-transaction \
  -f /m/begin-migrations.sql \
  "${MIGRATION_ARGS[@]}" \
  -f /m/finalize-migrations.sql
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
    & $aws ssm cancel-command --region $Region --command-id $CommandId 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not request cancellation for timed-out SSM command $CommandId."
    }
    throw "RDS migration timed out. Cancellation was requested; confirm SSM command $CommandId is terminal before retrying."
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
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not remove temporary S3 objects under s3://$Bucket/$Prefix/."
    }
  }
  Remove-Item $ManifestFile -ErrorAction SilentlyContinue
  Remove-Item $BaselineManifestFile -ErrorAction SilentlyContinue
  Remove-Item $ParametersFile -ErrorAction SilentlyContinue
}
