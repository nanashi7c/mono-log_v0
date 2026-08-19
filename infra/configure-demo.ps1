# Public demo one-time setup: disable the legacy Cognito user and initialize demo-owned DB data.
# Run after terraform apply, migration, and application deployment.

$ErrorActionPreference = "Stop"
$Region = "ap-northeast-1"
$Project = "mono-log"
$BundledAws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$Aws = if (Test-Path $BundledAws) { $BundledAws } else { "aws" }

function Assert-NativeCommand([string]$Description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed (exit code: $LASTEXITCODE)"
  }
}

function Get-ParameterValue([string]$Name) {
  $Value = (& $Aws ssm get-parameter --region $Region --name $Name `
      --query "Parameter.Value" --output text)
  Assert-NativeCommand "get SSM parameter $Name"
  return "$Value".Trim()
}

$UserPoolId = Get-ParameterValue "/$Project/cognito/user_pool_id"
$DemoUserId = Get-ParameterValue "/$Project/demo/user_id"
$DemoEmail = Get-ParameterValue "/$Project/demo/email"

Write-Host "== verify and disable the legacy Cognito demo user =="
$LookupOutput = @(& $Aws cognito-idp admin-get-user --region $Region `
    --user-pool-id $UserPoolId --username $DemoUserId `
    --query "UserAttributes[?Name=='email'].Value | [0]" --output text 2>&1)
$LookupExitCode = $LASTEXITCODE
$LookupText = "$($LookupOutput -join "`n")".Trim()

if ($LookupExitCode -eq 0) {
  if ($LookupText.ToLowerInvariant() -ne $DemoEmail.ToLowerInvariant()) {
    throw "The configured demo user ID does not belong to $DemoEmail. No user was disabled."
  }

  & $Aws cognito-idp admin-user-global-sign-out --region $Region `
    --user-pool-id $UserPoolId --username $DemoUserId
  Assert-NativeCommand "revoke the legacy Cognito demo sessions"

  & $Aws cognito-idp admin-disable-user --region $Region `
    --user-pool-id $UserPoolId --username $DemoUserId
  Assert-NativeCommand "disable the legacy Cognito demo user"
} elseif ($LookupText -match "UserNotFoundException") {
  Write-Host "No legacy Cognito demo user exists; nothing needs to be disabled."
} else {
  throw "Look up the Cognito demo user failed: $LookupText"
}

Write-Host "== initialize demo-owned data through the application =="
$InstanceId = (& $Aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Name,Values=$Project-ec2" "Name=instance-state-name,Values=running" `
    --query "Reservations[].Instances[].InstanceId | [0]" --output text)
Assert-NativeCommand "find the running app instance"
$InstanceId = "$InstanceId".Trim()
if (-not $InstanceId -or $InstanceId -eq "None") {
  throw "A running $Project EC2 instance was not found."
}

$ParametersJson = @{
  commands = @("systemctl start mono-log-demo-reset.service")
} | ConvertTo-Json -Compress
$TempFile = Join-Path $env:TEMP ("mono-log-demo-{0}.json" -f ([Guid]::NewGuid().ToString("N")))

try {
  Set-Content -Path $TempFile -Value $ParametersJson -Encoding ascii
  $TempFileUri = "file://" + ($TempFile -replace '\\', '/')
  $CommandId = (& $Aws ssm send-command --region $Region --instance-ids $InstanceId `
      --document-name "AWS-RunShellScript" --parameters $TempFileUri `
      --query "Command.CommandId" --output text)
  Assert-NativeCommand "start the initial demo reset"
  $CommandId = "$CommandId".Trim()

  $Deadline = (Get-Date).AddMinutes(3)
  $RunningStatuses = @("Pending", "InProgress", "Delayed")
  $Invocation = $null
  while ((Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 3
    $Json = (& $Aws ssm get-command-invocation --region $Region `
        --command-id $CommandId --instance-id $InstanceId --output json 2>$null)
    if ($LASTEXITCODE -ne 0) { continue }
    $Invocation = $Json | ConvertFrom-Json
    if ($Invocation.Status -notin $RunningStatuses) { break }
  }

  if (-not $Invocation -or $Invocation.Status -in $RunningStatuses) {
    throw "Demo reset timed out. Check SSM command $CommandId before retrying."
  }
  if ($Invocation.StandardOutputContent) {
    Write-Host $Invocation.StandardOutputContent.TrimEnd()
  }
  if ($Invocation.StandardErrorContent) {
    Write-Warning $Invocation.StandardErrorContent.TrimEnd()
  }
  if ($Invocation.Status -ne "Success") {
    throw "Demo reset failed (SSM status: $($Invocation.Status))."
  }
} finally {
  Remove-Item $TempFile -ErrorAction SilentlyContinue
}

Write-Host "Public demo setup completed successfully."
