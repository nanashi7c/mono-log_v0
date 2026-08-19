# Deploy the app: resolve an immutable tag -> build/push if needed -> refresh the EC2 container.
# Prereq: terraform apply done (EC2 running); docker + aws CLI installed; run migrate.ps1 first on a fresh RDS.
# Usage (from infra/): powershell -ExecutionPolicy Bypass -File deploy.ps1
# Rollback:            powershell -ExecutionPolicy Bypass -File deploy.ps1 -Rollback

param(
  [string]$Tag,
  [switch]$Rollback
)

$ErrorActionPreference = "Stop"
$aws = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$Region = "ap-northeast-1"
$Project = "mono-log"
$RepoRoot = Split-Path $PSScriptRoot -Parent  # repo root holds the Dockerfile
$ImageTagParameter = "/$Project/deploy/image_tag"
$PreviousImageTagParameter = "/$Project/deploy/previous_image_tag"

function Assert-NativeCommand([string]$Description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed (exit code: $LASTEXITCODE)"
  }
}

function Get-ParameterValue([string]$Name) {
  $Value = (& $aws ssm get-parameter --region $Region --name $Name --query "Parameter.Value" --output text)
  Assert-NativeCommand "get SSM parameter $Name"
  return "$Value".Trim()
}

function Set-ParameterValue([string]$Name, [string]$Value) {
  & $aws ssm put-parameter --region $Region --name $Name --type String --value $Value --overwrite --output text | Out-Null
  Assert-NativeCommand "update SSM parameter $Name"
}

function Test-ImageExists([string]$RepositoryName, [string]$ImageTag) {
  $Count = (& $aws ecr batch-get-image --region $Region --repository-name $RepositoryName `
      --image-ids "imageTag=$ImageTag" --query "length(images)" --output text)
  Assert-NativeCommand "look up ECR image $ImageTag"
  return "$Count".Trim() -eq "1"
}

function Assert-CleanWorktree {
  $Changes = (& git -C $RepoRoot status --porcelain)
  Assert-NativeCommand "inspect Git worktree"
  if ($Changes) {
    throw "Git worktree has uncommitted changes. Commit them before building an immutable image."
  }
}

if ($Rollback -and $Tag) {
  throw "-Tag and -Rollback cannot be used together."
}

if ($Rollback) {
  $Tag = Get-ParameterValue $PreviousImageTagParameter
  if (-not $Tag -or $Tag -eq "not-deployed") {
    throw "No previous image tag is available for rollback."
  }
} elseif (-not $Tag) {
  Assert-CleanWorktree
  $Tag = (& git -C $RepoRoot rev-parse HEAD)
  Assert-NativeCommand "resolve Git HEAD"
  $Tag = "$Tag".Trim()
}

if ($Tag -notmatch '^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$') {
  throw "Invalid Docker image tag: $Tag"
}

# Build ECR registry / repo URL from the account id.
$Acct = (& $aws sts get-caller-identity --query Account --output text)
Assert-NativeCommand "get AWS account id"
$Registry = "$Acct.dkr.ecr.$Region.amazonaws.com"
$Repo = "$Registry/$Project-app"
$RepositoryName = "$Project-app"

$ImageExists = Test-ImageExists $RepositoryName $Tag
if (-not $ImageExists) {
  if ($Rollback) {
    throw "Rollback image does not exist in ECR: $Tag"
  }
  Assert-CleanWorktree

  Write-Host "== ECR login =="
  # PowerShell の stdin パイプはトークンを壊して 400 になることがあるため --password で渡す
  $ecrPw = (& $aws ecr get-login-password --region $Region)
  Assert-NativeCommand "get ECR login password"
  docker login --username AWS --password $ecrPw $Registry
  Assert-NativeCommand "log in to ECR"

  Write-Host "== build & push (linux/arm64, tag: $Tag) =="
  # EC2 is t4g (ARM), so target linux/arm64 explicitly (slow via QEMU emulation on x64).
  # --provenance=false keeps a plain image manifest that the EC2 Docker can pull.
  docker buildx build --platform linux/arm64 --provenance=false -t "${Repo}:$Tag" --push $RepoRoot
  Assert-NativeCommand "build and push image $Tag"
} else {
  Write-Host "== reuse existing immutable image: ${Repo}:$Tag =="
}

Write-Host "== find EC2 instance =="
$Instance = (& $aws ec2 describe-instances --region $Region `
    --filters "Name=tag:Project,Values=$Project" "Name=instance-state-name,Values=running" `
    --query "Reservations[0].Instances[0].InstanceId" --output text)
Assert-NativeCommand "find running EC2 instance"
if (-not $Instance -or $Instance -eq "None") {
  throw "running EC2 not found (check terraform apply)"
}
Write-Host "instance: $Instance"

$CurrentTag = Get-ParameterValue $ImageTagParameter
Set-ParameterValue $ImageTagParameter $Tag

try {
  Write-Host "== refresh container via SSM (pull + re-run) =="
  $Cmd = (& $aws ssm send-command --region $Region --instance-ids $Instance `
      --document-name "AWS-RunShellScript" `
      --parameters 'commands=["systemctl restart mono-log.service"]' `
      --query "Command.CommandId" --output text)
  Assert-NativeCommand "start deployment command"
  Write-Host "SSM command id: $Cmd"

  & $aws ssm wait command-executed --region $Region --command-id $Cmd --instance-id $Instance
  Assert-NativeCommand "wait for deployment command"
  & $aws ssm get-command-invocation --region $Region --command-id $Cmd --instance-id $Instance `
      --query "{Status:Status, Stdout:StandardOutputContent, Stderr:StandardErrorContent}" --output json
  Assert-NativeCommand "read deployment result"
} catch {
  Set-ParameterValue $ImageTagParameter $CurrentTag
  throw
}

if ($CurrentTag -and $CurrentTag -ne "not-deployed" -and $CurrentTag -ne $Tag) {
  Set-ParameterValue $PreviousImageTagParameter $CurrentTag
}

Write-Host "== deployed immutable image: ${Repo}:$Tag =="
Write-Host "== Open the CloudFront domain below =="
& $aws cloudfront list-distributions `
    --query "DistributionList.Items[?Comment=='$Project app distribution'].DomainName" --output text
Assert-NativeCommand "look up CloudFront domain"
