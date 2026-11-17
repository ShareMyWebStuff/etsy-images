[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$Install,
  [switch]$RunWorker,
  [string]$ProjectPath = '',
  [string]$TaskName = 'Etsy Pinterest Publisher',
  [string]$UserId = '',
  [datetime]$StartAt = (Get-Date).Date.AddDays(1),
  [ValidateSet('S4U', 'Interactive')][string]$LogonType = 'S4U'
)

$ErrorActionPreference = 'Stop'
if (!$ProjectPath) { $ProjectPath = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..' }
$publisherRoot = (Resolve-Path -LiteralPath $ProjectPath).Path
$publisherScript = Join-Path $publisherRoot 'scripts\pinterest-publisher.cjs'
$publisherInstaller = Join-Path $publisherRoot 'scripts\install-pinterest-publisher.ps1'
$publisherEnv = Join-Path $publisherRoot '.env'
$publisherLocalEnv = Join-Path $publisherRoot '.env.local'
$publisherNode = (Get-Command node.exe -ErrorAction Stop).Source
$publisherPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath $publisherScript) -or !(Test-Path -LiteralPath $publisherEnv)) { throw 'The publisher script and .env must exist in the project.' }

if ($RunWorker) {
  $publisherLogs = Join-Path $publisherRoot '.tmp\pinterest-publisher\logs'
  New-Item -ItemType Directory -Path $publisherLogs -Force | Out-Null
  $publisherStamp = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss-fff'
  $publisherArguments = @(
    "--env-file=`"$publisherEnv`"",
    "--env-file-if-exists=`"$publisherLocalEnv`"",
    "`"$publisherScript`"",
    '--run'
  )
  $publisherProcess = Start-Process -FilePath $publisherNode -ArgumentList $publisherArguments -WorkingDirectory $publisherRoot -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $publisherLogs "$publisherStamp.out.log") -RedirectStandardError (Join-Path $publisherLogs "$publisherStamp.err.log")
  exit $publisherProcess.ExitCode
}

if ($StartAt -le (Get-Date)) { throw 'Choose a future start time. The task is intended to start tomorrow.' }
$publisherUser = if ($UserId) { $UserId } else { [Security.Principal.WindowsIdentity]::GetCurrent().Name }
$publisherActionArguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$publisherInstaller`" -RunWorker -ProjectPath `"$publisherRoot`""
$publisherReview = [ordered]@{
  TaskName = $TaskName
  User = $publisherUser
  LogonType = $LogonType
  Starts = $StartAt.ToString('o')
  IntervalMinutes = 5
  MaximumPinsPerRun = 5
  DefaultPinsPerBoardPerDay = 2
  MaximumCampaignPinsPerBoardPerDay = 4
  ProjectPath = $publisherRoot
  RequiresDevelopmentServer = $false
  InstallRequested = [bool]$Install
}
$publisherReview | ConvertTo-Json
if (!$Install) { return }

if ($PSCmdlet.ShouldProcess($TaskName, 'Register the hidden Pinterest publisher task')) {
  $publisherAction = New-ScheduledTaskAction -Execute $publisherPowerShell -Argument $publisherActionArguments -WorkingDirectory $publisherRoot
  $publisherTrigger = New-ScheduledTaskTrigger -Once -At $StartAt -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  $publisherPrincipal = New-ScheduledTaskPrincipal -UserId $publisherUser -LogonType $LogonType -RunLevel Limited
  $publisherSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $TaskName -Action $publisherAction -Trigger $publisherTrigger -Principal $publisherPrincipal -Settings $publisherSettings -Force | Out-Null
}
