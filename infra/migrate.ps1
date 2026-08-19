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

function Get-NormalizedMigrationChecksum([string]$Path) {
  $Content = [IO.File]::ReadAllText($Path)
  $NormalizedContent = [Regex]::Replace($Content, "`r(?=`n|$)", "")
  $Utf8WithoutBom = New-Object Text.UTF8Encoding($false)
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $Hash = $Hasher.ComputeHash($Utf8WithoutBom.GetBytes($NormalizedContent))
    return ([BitConverter]::ToString($Hash)).Replace("-", "").ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
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
$RunnerFile = Join-Path $env:TEMP "mono-log-migrate-$RunId.sh"
$ParametersFile = Join-Path $env:TEMP "mono-log-migrate-$RunId.json"
$Bucket = $null

try {
  $ManifestEntries = @($SelectedMigrations | ForEach-Object {
      $MigrationFile = Join-Path $_.FullName "migration.sql"
      $Checksum = Get-NormalizedMigrationChecksum $MigrationFile
      "$($_.Name).sql|$Checksum"
    })
  $BaselineEntries = @($SnapshotBaselineMigrations | ForEach-Object {
      $BaselineName = $_
      $BaselineDirectory = $MigrationDirectories | Where-Object { $_.Name -eq $BaselineName }
      $BaselineFile = Join-Path $BaselineDirectory.FullName "migration.sql"
      $Checksum = Get-NormalizedMigrationChecksum $BaselineFile
      "$BaselineName|$Checksum"
    })
  $ManifestContent = if ($ManifestEntries.Count -eq 0) { "" } else { ($ManifestEntries -join "`n") + "`n" }
  $BaselineContent = ($BaselineEntries -join "`n") + "`n"
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

mapfile -t MIGRATION_ENTRIES < "$WORKDIR/manifest.txt"
mapfile -t BASELINE_ENTRIES < "$WORKDIR/baseline.txt"

if [ "${#BASELINE_ENTRIES[@]}" -eq 0 ]; then
  echo "Snapshot baseline manifest is empty." >&2
  exit 1
fi

BASELINE_MIGRATIONS=()
BASELINE_CHECKSUMS=()
for entry in "${BASELINE_ENTRIES[@]}"; do
  entry=${entry%$'\r'}
  IFS='|' read -r baseline_migration baseline_checksum extra <<< "$entry"
  if [[ ! "$baseline_migration" =~ ^[0-9A-Za-z_-]+$ ]] ||
     [[ ! "$baseline_checksum" =~ ^[0-9a-f]{64}$ ]] || [ -n "${extra:-}" ]; then
    echo "Invalid snapshot baseline manifest entry: $entry" >&2
    exit 1
  fi
  BASELINE_MIGRATIONS+=( "$baseline_migration" )
  BASELINE_CHECKSUMS+=( "$baseline_checksum" )
done
INITIAL_MIGRATION=${BASELINE_MIGRATIONS[0]}
INITIAL_CHECKSUM=${BASELINE_CHECKSUMS[0]}

MIGRATION_FILES=()
MIGRATION_CHECKSUMS=()
for entry in "${MIGRATION_ENTRIES[@]}"; do
  entry=${entry%$'\r'}
  [ -z "$entry" ] && continue
  IFS='|' read -r migration checksum extra <<< "$entry"
  if [[ ! "$migration" =~ ^[0-9A-Za-z_-]+\.sql$ ]] ||
     [[ ! "$checksum" =~ ^[0-9a-f]{64}$ ]] || [ -n "${extra:-}" ]; then
    echo "Invalid migration manifest entry: $entry" >&2
    exit 1
  fi
  if [ ! -f "$WORKDIR/$migration" ]; then
    echo "Migration file not found: $migration" >&2
    exit 1
  fi
  actual_checksum=$(sed '1s/^\xEF\xBB\xBF//; s/\r$//' "$WORKDIR/$migration" | sha256sum | awk '{print $1}')
  if [ "$actual_checksum" != "$checksum" ]; then
    echo "Migration checksum mismatch after S3 transfer: $migration" >&2
    exit 1
  fi
  MIGRATION_FILES+=( "$migration" )
  MIGRATION_CHECKSUMS+=( "$checksum" )
done

RESTORED_SNAPSHOT=false
if [ "$MODE" = "restored-snapshot" ]; then
  RESTORED_SNAPSHOT=true
fi

cat > "$WORKDIR/run-migrations.sql" <<'SQL'
\set ON_ERROR_STOP on
select pg_advisory_xact_lock(hashtext('mono-log-schema-migrations'));
select
  (to_regclass('public.users') is not null)::text as base_schema_exists,
  (to_regclass('app.schema_migrations') is not null)::text as migration_history_exists
\gset

\if :restored_snapshot
\if :base_schema_exists
\else
\echo 'Restored snapshot mode requires the baseline schema, but public.users is missing.'
select 1 / 0;
\endif
\else
\if :base_schema_exists
\if :migration_history_exists
\else
\echo 'Existing schema has no migration history. Use -RestoredSnapshot only for the documented snapshot baseline.'
select 1 / 0;
\endif
\endif
\endif
SQL

cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\if :migration_history_exists
SQL
printf "select exists(select 1 from app.schema_migrations where name = '%s')::text as initial_migration_recorded, coalesce((select checksum = '%s' from app.schema_migrations where name = '%s'), false)::text as initial_checksum_matches;\n" \
  "$INITIAL_MIGRATION" "$INITIAL_CHECKSUM" "$INITIAL_MIGRATION" >> "$WORKDIR/run-migrations.sql"
cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\gset
\if :initial_migration_recorded
\if :initial_checksum_matches
\else
\echo 'Applied initial migration checksum does not match the repository.'
select 1 / 0;
\endif
\else
\echo 'Migration history is inconsistent: initial migration is not recorded.'
select 1 / 0;
\endif
\endif

\if :base_schema_exists
\else
SQL
printf "\\ir /m/%s.sql\n" "$INITIAL_MIGRATION" >> "$WORKDIR/run-migrations.sql"
cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\endif

create table if not exists app.schema_migrations (
  name text primary key,
  checksum char(64) not null,
  applied_at timestamptz not null default now()
);
SQL

cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\if :base_schema_exists
\if :migration_history_exists
\else
SQL
  for index in "${!BASELINE_MIGRATIONS[@]}"; do
    printf "insert into app.schema_migrations (name, checksum) values ('%s', '%s') on conflict (name) do nothing;\n" \
      "${BASELINE_MIGRATIONS[$index]}" "${BASELINE_CHECKSUMS[$index]}" >> "$WORKDIR/run-migrations.sql"
  done
cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\endif
\else
SQL
printf "insert into app.schema_migrations (name, checksum) values ('%s', '%s') on conflict (name) do nothing;\n" \
  "$INITIAL_MIGRATION" "$INITIAL_CHECKSUM" >> "$WORKDIR/run-migrations.sql"
cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\endif
SQL

for index in "${!MIGRATION_FILES[@]}"; do
  migration=${MIGRATION_FILES[$index]}
  checksum=${MIGRATION_CHECKSUMS[$index]}
  migration_name=${migration%.sql}
  [ "$migration_name" = "$INITIAL_MIGRATION" ] && continue

  printf "select exists(select 1 from app.schema_migrations where name = '%s')::text as migration_applied, coalesce((select checksum = '%s' from app.schema_migrations where name = '%s'), false)::text as migration_checksum_matches;\n" \
    "$migration_name" "$checksum" "$migration_name" >> "$WORKDIR/run-migrations.sql"
  cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\gset
\if :migration_applied
\if :migration_checksum_matches
\else
\echo 'Applied migration checksum does not match the repository.'
select 1 / 0;
\endif
\else
SQL
  printf "\\ir /m/%s\n" "$migration" >> "$WORKDIR/run-migrations.sql"
  printf "insert into app.schema_migrations (name, checksum) values ('%s', '%s');\n" \
    "$migration_name" "$checksum" >> "$WORKDIR/run-migrations.sql"
  cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\endif
SQL
done

for index in "${!BASELINE_MIGRATIONS[@]}"; do
  printf "select exists(select 1 from app.schema_migrations where name = '%s')::text as baseline_recorded, coalesce((select checksum = '%s' from app.schema_migrations where name = '%s'), false)::text as baseline_checksum_matches;\n" \
    "${BASELINE_MIGRATIONS[$index]}" "${BASELINE_CHECKSUMS[$index]}" "${BASELINE_MIGRATIONS[$index]}" >> "$WORKDIR/run-migrations.sql"
  cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\gset
\if :baseline_recorded
\if :baseline_checksum_matches
\else
\echo 'Applied baseline migration checksum does not match the repository.'
select 1 / 0;
\endif
\else
\echo 'Migration history is inconsistent: baseline migration is not recorded.'
select 1 / 0;
\endif
SQL
done

REPOSITORY_MIGRATIONS=()
declare -A SEEN_MIGRATIONS=()
for migration_name in "${BASELINE_MIGRATIONS[@]}"; do
  if [ -z "${SEEN_MIGRATIONS[$migration_name]+present}" ]; then
    REPOSITORY_MIGRATIONS+=( "$migration_name" )
    SEEN_MIGRATIONS[$migration_name]=present
  fi
done
for migration in "${MIGRATION_FILES[@]}"; do
  migration_name=${migration%.sql}
  if [ -z "${SEEN_MIGRATIONS[$migration_name]+present}" ]; then
    REPOSITORY_MIGRATIONS+=( "$migration_name" )
    SEEN_MIGRATIONS[$migration_name]=present
  fi
done

repository_names_sql=""
for migration_name in "${REPOSITORY_MIGRATIONS[@]}"; do
  if [ -n "$repository_names_sql" ]; then
    repository_names_sql+=", "
  fi
  repository_names_sql+="'$migration_name'"
done
printf "select (not exists(select 1 from app.schema_migrations where name not in (%s)))::text as migration_history_matches_repository;\n" \
  "$repository_names_sql" >> "$WORKDIR/run-migrations.sql"
cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
\gset
\if :migration_history_matches_repository
\else
\echo 'Migration history contains a migration that is missing or renamed in the repository.'
select 1 / 0;
\endif
SQL

cat >> "$WORKDIR/run-migrations.sql" <<'SQL'
ALTER ROLE monolog_app WITH PASSWORD :'app_password';
SQL

docker run --rm -e PGPASSWORD="$MPW" -v "$WORKDIR:/m:ro" postgres:16 \
  psql -h "$HOST" -U monolog_admin -d monolog \
  -v ON_ERROR_STOP=1 -v app_password="$APW" -v restored_snapshot="$RESTORED_SNAPSHOT" \
  --single-transaction -f /m/run-migrations.sql
'@
  $Bash = $Bash.Replace("__REGION__", $Region).
      Replace("__PROJECT__", $Project).
      Replace("__BUCKET__", $Bucket).
      Replace("__PREFIX__", $Prefix).
      Replace("__MODE__", $Mode).
      Replace("__RUN_ID__", $RunId)
  $Bash = $Bash -replace "`r`n", "`n"

  [IO.File]::WriteAllText($RunnerFile, $Bash, [Text.UTF8Encoding]::new($false))
  & $aws s3 cp $RunnerFile "s3://$Bucket/$Prefix/run-migrations.sh" --region $Region | Out-Null
  Assert-NativeCommand "upload migration runner"

  $RemoteRunner = "/tmp/mono-log-migrate-$RunId.sh"
  $ShellCommand = "aws s3 cp `"s3://$Bucket/$Prefix/run-migrations.sh`" `"$RemoteRunner`" --region `"$Region`" && bash `"$RemoteRunner`"; result=`$?; rm -f `"$RemoteRunner`"; exit `$result"
  $ParametersJson = @{ commands = @($ShellCommand) } | ConvertTo-Json -Compress
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
  Remove-Item $RunnerFile -ErrorAction SilentlyContinue
  Remove-Item $ParametersFile -ErrorAction SilentlyContinue
}
