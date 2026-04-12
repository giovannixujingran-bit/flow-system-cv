[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OwnerUserId,
  [Parameter(Mandatory = $true)][int]$UiPort,
  [Parameter(Mandatory = $true)][string]$PlatformWebOrigin,
  [Parameter(Mandatory = $true)][string]$OverlayDataRoot,
[Parameter(Mandatory = $true)][string]$ReadyFile,
  [Parameter(Mandatory = $true)][string]$LogFile
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "OverlayHttp.ps1")

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Threading

$script:CollapsedSize = 88
$script:ExpandedWidth = 404
$script:ExpandedHeight = 668
$script:ScreenMargin = 18
$script:BaseUrl = "http://127.0.0.1:$UiPort"
$script:StatePath = Join-Path $OverlayDataRoot "state.json"
$script:IsQuitting = $false
$script:IsExpanded = $false
$script:IsTransitioning = $false
$script:OverlayMutex = $null
$script:ActiveTab = "conversation"
$script:CurrentBootstrap = $null
$script:CurrentConversations = @()
$script:CurrentConversationViews = @()
$script:CurrentTasks = @()
$script:CurrentOrbVisualState = $null
$script:TransitionTimer = $null
$script:PendingTransitionExpanded = $null
$script:TransitionStartedAtUtc = $null
$script:NotifyIcon = $null
$script:BrushConverter = New-Object System.Windows.Media.BrushConverter
$script:OverlayAnimation = @{
  fade_duration_ms = 140
}
$script:UiText = @{}
$script:HttpClient = $null
$uiTextObject = ConvertFrom-Json @'
{
  "header_conversation": "\u4f1a\u8bdd",
  "header_tasks": "\u5f53\u524d\u4efb\u52a1",
  "owner_fallback": "\u6211",
  "sync_pending": "\u7b49\u5f85\u672c\u673a OpenClaw \u5904\u7406",
  "sync_done": "\u5df2\u9001\u8fbe\u672c\u673a OpenClaw",
  "empty_conversations": "\u5f00\u59cb\u548c\u672c\u673a OpenClaw \u5bf9\u8bdd\u3002",
  "empty_tasks": "\u5f53\u524d\u6ca1\u6709\u4efb\u52a1\u3002",
  "open_task_failed": "\u6253\u5f00\u4efb\u52a1\u5931\u8d25\uff1a{0}",
  "connect_failed": "\u65e0\u6cd5\u8fde\u63a5\u672c\u673a Agent\uff1a{0}",
  "load_conversations_failed": "\u52a0\u8f7d\u4f1a\u8bdd\u5931\u8d25\uff1a{0}",
  "load_tasks_failed": "\u52a0\u8f7d\u4efb\u52a1\u5931\u8d25\uff1a{0}",
  "send_failed": "\u53d1\u9001\u5931\u8d25\uff1a{0}",
  "openclaw_status": "OpenClaw \u72b6\u6001\uff1a{0}",
  "openclaw_not_configured": "\u672a\u63a5\u5165",
  "collapse_button": "\u6536\u8d77",
  "send_button": "\u53d1\u9001",
  "tray_open_overlay": "\u6253\u5f00\u60ac\u6d6e\u7403",
  "tray_open_platform": "\u6253\u5f00\u5e73\u53f0",
  "tray_reconnect": "\u91cd\u65b0\u8fde\u63a5\u672c\u673a Agent",
  "tray_exit": "\u9000\u51fa\u60ac\u6d6e\u7403"
}
'@
$uiTextObject.PSObject.Properties | ForEach-Object {
  $script:UiText[$_.Name] = [string]$_.Value
}

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Write-Log {
  param([Parameter(Mandatory = $true)][string]$Message)
  $line = "[{0}] {1}" -f ([DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")), $Message
  Add-Content -LiteralPath $LogFile -Value $line -Encoding utf8
}

function Remove-OwnedReadyFile {
  if (-not (Test-Path -LiteralPath $ReadyFile)) {
    return
  }

  try {
    $payload = Get-Content -LiteralPath $ReadyFile -Raw -Encoding utf8 | ConvertFrom-Json
    if ($payload.pid -and ([int]$payload.pid) -ne $PID) {
      return
    }
  } catch {
    Write-Log ("Failed to inspect ready file ownership: {0}" -f $_.Exception.Message)
  }

  Remove-Item -LiteralPath $ReadyFile -Force -ErrorAction SilentlyContinue
}

function Initialize-OverlayMutex {
  $createdNew = $false
  $mutexName = "Local\FlowSystemDesktopOverlay_{0}" -f ($OwnerUserId -replace "[^A-Za-z0-9_]", "_")
  $script:OverlayMutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$createdNew)
  if (-not $createdNew) {
    throw "Another overlay instance is already running for $OwnerUserId."
  }
}

function Get-UiText {
  param(
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(ValueFromRemainingArguments = $true)][object[]]$Args
  )

  $template = [string]$script:UiText[$Key]
  if ($null -eq $Args -or $Args.Count -eq 0) {
    return $template
  }

  return ($template -f $Args)
}

function Get-Brush {
  param([Parameter(Mandatory = $true)][string]$Color)
  return $script:BrushConverter.ConvertFromString($Color)
}

function Get-Color {
  param([Parameter(Mandatory = $true)][string]$Color)
  return [System.Windows.Media.ColorConverter]::ConvertFromString($Color)
}

function Start-RotateAnimation {
  param(
    [Parameter(Mandatory = $true)]$Target,
    [Parameter(Mandatory = $true)][double]$From,
    [Parameter(Mandatory = $true)][double]$To,
    [Parameter(Mandatory = $true)][double]$DurationSeconds
  )

  $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
  $animation.From = $From
  $animation.To = $To
  $animation.Duration = [System.Windows.Duration]::new([TimeSpan]::FromSeconds($DurationSeconds))
  $animation.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
  $Target.BeginAnimation([System.Windows.Media.RotateTransform]::AngleProperty, $animation)
}

function Set-OrbAnimationProfile {
  param([Parameter(Mandatory = $true)][string]$OrbState)

  $profile = switch ($OrbState) {
    "processing" {
      @{
        primary_wire = 6.8
        secondary_wire = 4.9
        primary_orbit = 3.6
        secondary_orbit = 2.7
      }
    }
    default {
      @{
        primary_wire = 11.8
        secondary_wire = 8.6
        primary_orbit = 7.1
        secondary_orbit = 5.6
      }
    }
  }

  Start-RotateAnimation -Target $controls.OrbPrimaryWireRotate -From 0 -To 360 -DurationSeconds $profile.primary_wire
  Start-RotateAnimation -Target $controls.OrbSecondaryWireRotate -From 360 -To 0 -DurationSeconds $profile.secondary_wire
  Start-RotateAnimation -Target $controls.OrbPrimaryOrbitRotate -From 18 -To 378 -DurationSeconds $profile.primary_orbit
  Start-RotateAnimation -Target $controls.OrbSecondaryOrbitRotate -From 110 -To -250 -DurationSeconds $profile.secondary_orbit
}

function Apply-OrbVisualPalette {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Palette,
    [Parameter(Mandatory = $true)][string]$OrbState
  )

  $controls.OrbBorder.Background = Get-Brush $Palette.border_background
  $controls.OrbBorder.BorderBrush = Get-Brush $Palette.border_brush
  $controls.OrbSurface.Fill = Get-Brush $Palette.surface_fill
  $controls.OrbSurface.Stroke = Get-Brush $Palette.surface_stroke
  $controls.OrbAtmosphere.Stroke = Get-Brush $Palette.atmosphere_stroke
  $controls.OrbSurfaceGlow.Opacity = $Palette.surface_glow_opacity

  $controls.OrbPrimaryMeridianA.Stroke = Get-Brush $Palette.accent_stroke
  $controls.OrbSecondaryLatitudeB.Stroke = Get-Brush $Palette.accent_stroke
  $controls.OrbHighlightArcSecondary.Stroke = Get-Brush $Palette.accent_stroke
  $controls.OrbOrbitSecondary.Stroke = Get-Brush $Palette.orbit_secondary_stroke
  $controls.OrbOrbitSecondaryDot.Fill = Get-Brush $Palette.orbit_secondary_dot

  foreach ($element in @(
    $controls.OrbPrimaryMeridianB,
    $controls.OrbPrimaryMeridianC,
    $controls.OrbSecondaryLatitudeA,
    $controls.OrbSecondaryLatitudeC
  )) {
    $element.Stroke = Get-Brush $Palette.soft_stroke
  }

  $controls.OrbHighlightArcPrimary.Stroke = Get-Brush $Palette.highlight_arc
  $controls.OrbOrbitPrimary.Stroke = Get-Brush $Palette.orbit_primary_stroke
  $controls.OrbOrbitPrimaryDot.Fill = Get-Brush $Palette.orbit_primary_dot

  $haloBrush = New-Object System.Windows.Media.RadialGradientBrush
  $haloBrush.Center = [System.Windows.Point]::new(0.5, 0.5)
  $haloBrush.GradientOrigin = [System.Windows.Point]::new(0.5, 0.5)
  $haloBrush.RadiusX = 0.54
  $haloBrush.RadiusY = 0.54
  $haloBrush.GradientStops.Add([System.Windows.Media.GradientStop]::new((Get-Color $Palette.halo_inner), 0.0))
  $haloBrush.GradientStops.Add([System.Windows.Media.GradientStop]::new((Get-Color $Palette.halo_mid), 0.44))
  $haloBrush.GradientStops.Add([System.Windows.Media.GradientStop]::new((Get-Color $Palette.halo_outer), 1.0))
  $controls.OrbHalo.Fill = $haloBrush
  ([System.Windows.Media.Effects.BlurEffect]$controls.OrbHalo.Effect).Radius = $Palette.halo_blur

  $shadow = [System.Windows.Media.Effects.DropShadowEffect]$controls.OrbBorder.Effect
  $shadow.Color = Get-Color $Palette.shadow_color
  $shadow.BlurRadius = $Palette.shadow_blur
  $shadow.Opacity = $Palette.shadow_opacity

  $controls.OrbSurfaceGlow.Opacity = $Palette.surface_glow_opacity
}

function Get-WorkArea {
  return [System.Windows.SystemParameters]::WorkArea
}

function Get-DefaultCollapsedPosition {
  $workArea = Get-WorkArea
  return @{
    x = [int]($workArea.Right - $script:CollapsedSize - $script:ScreenMargin)
    y = [int]($workArea.Bottom - $script:CollapsedSize - $script:ScreenMargin)
  }
}

function New-DefaultState {
  return [ordered]@{
    window_position = Get-DefaultCollapsedPosition
    first_run_completed = $true
    last_tab = "conversation"
    muted = $false
    last_platform_url = $PlatformWebOrigin
    last_read_conversation_message_at = $null
  }
}

function Load-State {
  $state = New-DefaultState
  if (-not (Test-Path -LiteralPath $script:StatePath)) {
    return $state
  }

  try {
    $raw = Get-Content -LiteralPath $script:StatePath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($raw.window_position) {
      $state.window_position = @{
        x = [int]$raw.window_position.x
        y = [int]$raw.window_position.y
      }
    }
    foreach ($propertyName in @("first_run_completed", "last_tab", "muted", "last_platform_url", "last_read_conversation_message_at")) {
      if ($raw.PSObject.Properties.Name -contains $propertyName) {
        $state[$propertyName] = $raw.$propertyName
      }
    }
  } catch {
    Write-Log ("Failed to read state.json: {0}" -f $_.Exception.Message)
  }

  return $state
}

function Save-State {
  $payload = $script:OverlayState | ConvertTo-Json -Depth 6
  Set-Content -LiteralPath $script:StatePath -Value $payload -Encoding utf8
}

function Invoke-OverlayApi {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Method = "GET",
    $Body = $null
  )

  return Invoke-OverlayJsonRequest -Client $script:HttpClient -BaseUrl $script:BaseUrl -Path $Path -Method $Method -Body $Body
}

function Set-ErrorBanner {
  param([string]$Message)

  if ([string]::IsNullOrWhiteSpace($Message)) {
    $controls.ErrorText.Text = ""
    $controls.ErrorBanner.Visibility = [System.Windows.Visibility]::Collapsed
    return
  }

  $controls.ErrorText.Text = $Message
  $controls.ErrorBanner.Visibility = [System.Windows.Visibility]::Visible
}

function Get-UnreadCount {
  if ($null -eq $script:CurrentBootstrap) {
    return 0
  }

  if ($script:CurrentBootstrap.unread -and $script:CurrentBootstrap.unread.count -ne $null) {
    return [int]$script:CurrentBootstrap.unread.count
  }

  return 0
}

function Update-OrbState {
  $count = Get-UnreadCount
  $controls.UnreadBadgeText.Text = [string]$count
  if ($count -gt 0) {
    $controls.UnreadBadge.Visibility = [System.Windows.Visibility]::Visible
  } else {
    $controls.UnreadBadge.Visibility = [System.Windows.Visibility]::Collapsed
  }

  $orbState = "idle"
  if ($script:CurrentBootstrap -and $script:CurrentBootstrap.orb_state) {
    $orbState = [string]$script:CurrentBootstrap.orb_state
  }

  if ($script:CurrentOrbVisualState -eq $orbState) {
    return
  }

  $palette = switch ($orbState) {
    "error" {
      @{
        border_background = "#162C1320"
        border_brush = "#26FFE1EA"
        surface_fill = "#FF301423"
        surface_stroke = "#24FFF2F6"
        atmosphere_stroke = "#18FFE1EA"
        accent_stroke = "#FFFF7A94"
        soft_stroke = "#72FFE2EC"
        highlight_arc = "#86FFF2F6"
        orbit_primary_stroke = "#38FFF2F6"
        orbit_primary_dot = "#FFF6EEF2"
        orbit_secondary_stroke = "#70FF7A94"
        orbit_secondary_dot = "#FFFF7A94"
        halo_inner = "#72FF7A94"
        halo_mid = "#28FF7A94"
        halo_outer = "#00301423"
        halo_blur = 20
        shadow_color = "#B0FF7A94"
        shadow_blur = 26
        shadow_opacity = 0.86
        surface_glow_opacity = 0.5
      }
    }
    "unread" {
      @{
        border_background = "#1423153C"
        border_brush = "#28FFF8FB"
        surface_fill = "#FF23153C"
        surface_stroke = "#22FFF8FB"
        atmosphere_stroke = "#1CFFF8FB"
        accent_stroke = "#FFFF5F9C"
        soft_stroke = "#7CFFF8FB"
        highlight_arc = "#96FFF8FB"
        orbit_primary_stroke = "#46FFF8FB"
        orbit_primary_dot = "#FFFFF8FB"
        orbit_secondary_stroke = "#84FF5F9C"
        orbit_secondary_dot = "#FFFF5F9C"
        halo_inner = "#94FF5F9C"
        halo_mid = "#34FF5F9C"
        halo_outer = "#0023153C"
        halo_blur = 21
        shadow_color = "#C2FF5F9C"
        shadow_blur = 28
        shadow_opacity = 0.94
        surface_glow_opacity = 0.5
      }
    }
    "processing" {
      @{
        border_background = "#1423153C"
        border_brush = "#2CFFF8FB"
        surface_fill = "#FF23153C"
        surface_stroke = "#22FFF8FB"
        atmosphere_stroke = "#1CFFF8FB"
        accent_stroke = "#FFFF7AAB"
        soft_stroke = "#8AFFF8FB"
        highlight_arc = "#A2FFF8FB"
        orbit_primary_stroke = "#54FFF8FB"
        orbit_primary_dot = "#FFFFF8FB"
        orbit_secondary_stroke = "#96FF7AAB"
        orbit_secondary_dot = "#FFFF7AAB"
        halo_inner = "#A6FF7AAB"
        halo_mid = "#42FF7AAB"
        halo_outer = "#0023153C"
        halo_blur = 22
        shadow_color = "#D2FF7AAB"
        shadow_blur = 30
        shadow_opacity = 1
        surface_glow_opacity = 0.58
      }
    }
    default {
      @{
        border_background = "#1223153C"
        border_brush = "#24FFF8FB"
        surface_fill = "#FF23153C"
        surface_stroke = "#20FFF8FB"
        atmosphere_stroke = "#18FFF8FB"
        accent_stroke = "#FFFF5F9C"
        soft_stroke = "#66FFF8FB"
        highlight_arc = "#74FFF8FB"
        orbit_primary_stroke = "#34FFF8FB"
        orbit_primary_dot = "#FFF8FB"
        orbit_secondary_stroke = "#5CFF5F9C"
        orbit_secondary_dot = "#FFFF5F9C"
        halo_inner = "#74FF5F9C"
        halo_mid = "#24FF5F9C"
        halo_outer = "#0023153C"
        halo_blur = 19
        shadow_color = "#A0FF5F9C"
        shadow_blur = 24
        shadow_opacity = 0.82
        surface_glow_opacity = 0.42
      }
    }
  }

  Apply-OrbVisualPalette -Palette $palette -OrbState $orbState
  Set-OrbAnimationProfile -OrbState $orbState
  $script:CurrentOrbVisualState = $orbState
}

function Set-HeaderConnectionIndicator {
  param(
    [Parameter(Mandatory = $true)][bool]$Connected,
    [Parameter(Mandatory = $true)][bool]$Visible
  )

  $controls.HeaderStatusDot.Visibility = if ($Visible) {
    [System.Windows.Visibility]::Visible
  } else {
    [System.Windows.Visibility]::Collapsed
  }

  if (-not $Visible) {
    return
  }

  if ($Connected) {
    $controls.HeaderStatusDot.Fill = Get-Brush "#16A34A"
  } else {
    $controls.HeaderStatusDot.Fill = Get-Brush "#DC2626"
  }
}

function New-MessageBubble {
  param($MessageView)

  $container = New-Object System.Windows.Controls.StackPanel
  $container.Margin = "0,0,0,10"
  $container.MaxWidth = 292
  if ([string]$MessageView.align -eq "right") {
    $container.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Right
  } else {
    $container.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left
  }

  $border = New-Object System.Windows.Controls.Border
  $border.CornerRadius = New-Object System.Windows.CornerRadius 20
  $border.Padding = "14,12"
  $border.BorderThickness = "1"
  $border.BorderBrush = Get-Brush "#00000000"
  if ([string]$MessageView.align -eq "right") {
    $border.Background = Get-Brush "#FFF1F5F9"
  } else {
    $border.Background = Get-Brush "#FFFFFFFF"
  }

  $stack = New-Object System.Windows.Controls.StackPanel

  $meta = New-Object System.Windows.Controls.TextBlock
  $meta.FontSize = 11
  $meta.Foreground = Get-Brush "#8A475569"
  $meta.Margin = "0,0,0,6"
  $meta.Text = "{0}  {1}" -f ([string]$MessageView.author_label), ([string]$MessageView.time_label)
  $stack.Children.Add($meta) | Out-Null

  $body = New-Object System.Windows.Controls.TextBlock
  $body.FontSize = 14
  $body.Foreground = Get-Brush "#0F172A"
  $body.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $body.Text = [string]$MessageView.body
  $stack.Children.Add($body) | Out-Null

  if (-not [string]::IsNullOrWhiteSpace([string]$MessageView.sync_label)) {
    $sync = New-Object System.Windows.Controls.TextBlock
    $sync.FontSize = 11
    $sync.Foreground = Get-Brush "#8A475569"
    $sync.Margin = "0,8,0,0"
    $sync.Text = [string]$MessageView.sync_label
    $stack.Children.Add($sync) | Out-Null
  }

  $border.Child = $stack
  $container.Children.Add($border) | Out-Null
  return $container
}

<#
function Get-AvatarText {
  param([string]$Value)

  $text = [string]$Value
  $text = $text.Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return "我"
  }

  try {
    return [System.Globalization.StringInfo]::GetNextTextElement($text)
  } catch {
    return $text.Substring(0, 1)
  }
}

function New-TaskUserChip {
  param([string]$DisplayName)

  $chip = New-Object System.Windows.Controls.Border
  $chip.Background = $script:Window.FindResource("OverlayTaskChipBrush")
  $chip.BorderBrush = $script:Window.FindResource("OverlayTaskChipBorderBrush")
  $chip.BorderThickness = "1"
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 999
  $chip.Padding = "8,6,12,6"
  $chip.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left

  $row = New-Object System.Windows.Controls.StackPanel
  $row.Orientation = [System.Windows.Controls.Orientation]::Horizontal

  $avatar = New-Object System.Windows.Controls.Border
  $avatar.Width = 24
  $avatar.Height = 24
  $avatar.CornerRadius = New-Object System.Windows.CornerRadius 999
  $avatar.Background = $script:Window.FindResource("OverlayTaskAvatarBrush")
  $avatar.Margin = "0,0,10,0"

  $avatarText = New-Object System.Windows.Controls.TextBlock
  $avatarText.Text = Get-AvatarText -Value $DisplayName
  $avatarText.FontSize = 12
  $avatarText.FontWeight = [System.Windows.FontWeights]::Bold
  $avatarText.Foreground = Get-Brush "#0F172A"
  $avatarText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
  $avatarText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $avatar.Child = $avatarText

  $nameText = New-Object System.Windows.Controls.TextBlock
  $nameText.Text = $DisplayName
  $nameText.FontSize = 13
  $nameText.Foreground = Get-Brush "#0F172A"
  $nameText.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
  $nameText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

  $row.Children.Add($avatar) | Out-Null
  $row.Children.Add($nameText) | Out-Null
  $chip.Child = $row
  return $chip
}

function New-TaskCard {
  param($Task)

  $button = New-Object System.Windows.Controls.Button
  $button.Style = $script:Window.FindResource("TaskCardButtonStyle")
  $button.Margin = "0,0,0,10"
  $button.MinHeight = 120

  $layout = New-Object System.Windows.Controls.Grid
  $layout.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto })) | Out-Null
  $layout.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) })) | Out-Null
  $layout.RowDefinitions.Add((New-Object System.Windows.Controls.RowDefinition -Property @{ Height = [System.Windows.GridLength]::Auto })) | Out-Null

  $project = New-Object System.Windows.Controls.TextBlock
  $project.FontSize = 12
  $project.Foreground = Get-Brush "#8A475569"
  $project.Text = [string]$Task.project_name
  [System.Windows.Controls.Grid]::SetRow($project, 0)
  $layout.Children.Add($project) | Out-Null

  $title = New-Object System.Windows.Controls.TextBlock
  $title.FontSize = 15
  $title.FontWeight = [System.Windows.FontWeights]::SemiBold
  $title.Foreground = Get-Brush "#0F172A"
  $title.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $title.Margin = "0,10,0,12"
  $title.MaxHeight = 46
  $title.Text = [string]$Task.task_title
  [System.Windows.Controls.Grid]::SetRow($title, 1)
  $layout.Children.Add($title) | Out-Null

  $userChip = New-TaskUserChip -DisplayName ([string]$Task.user_display_name)
  [System.Windows.Controls.Grid]::SetRow($userChip, 2)
  $layout.Children.Add($userChip) | Out-Null

  $button.Content = $layout

  $taskId = [string]$Task.task_id
  $button.Add_Click({
    try {
      Invoke-OverlayApi -Path "/api/overlay/tasks/$taskId/open" -Method "POST" | Out-Null
      Set-ErrorBanner ""
    } catch {
      Set-ErrorBanner (Get-UiText "open_task_failed" $_.Exception.Message)
    }
  }.GetNewClosure())

  return $button
}

#>

function Get-AvatarText {
  param([string]$Value)

  $text = [string]$Value
  $text = $text.Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return "U"
  }

  try {
    return [System.Globalization.StringInfo]::GetNextTextElement($text)
  } catch {
    return $text.Substring(0, 1)
  }
}

function New-TaskUserChip {
  param([string]$DisplayName)

  $chip = New-Object System.Windows.Controls.Border
  $chip.Background = $script:Window.FindResource("OverlayTaskChipBrush")
  $chip.BorderBrush = $script:Window.FindResource("OverlayTaskChipBorderBrush")
  $chip.BorderThickness = "1"
  $chip.CornerRadius = New-Object System.Windows.CornerRadius 999
  $chip.Padding = "8,6,12,6"
  $chip.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Left

  $row = New-Object System.Windows.Controls.StackPanel
  $row.Orientation = [System.Windows.Controls.Orientation]::Horizontal

  $avatar = New-Object System.Windows.Controls.Border
  $avatar.Width = 24
  $avatar.Height = 24
  $avatar.CornerRadius = New-Object System.Windows.CornerRadius 999
  $avatar.Background = $script:Window.FindResource("OverlayTaskAvatarBrush")
  $avatar.Margin = "0,0,10,0"

  $avatarText = New-Object System.Windows.Controls.TextBlock
  $avatarText.Text = Get-AvatarText -Value $DisplayName
  $avatarText.FontSize = 12
  $avatarText.FontWeight = [System.Windows.FontWeights]::Bold
  $avatarText.Foreground = Get-Brush "#0F172A"
  $avatarText.HorizontalAlignment = [System.Windows.HorizontalAlignment]::Center
  $avatarText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
  $avatar.Child = $avatarText

  $nameText = New-Object System.Windows.Controls.TextBlock
  $nameText.Text = $DisplayName
  $nameText.FontSize = 13
  $nameText.Foreground = Get-Brush "#0F172A"
  $nameText.TextTrimming = [System.Windows.TextTrimming]::CharacterEllipsis
  $nameText.VerticalAlignment = [System.Windows.VerticalAlignment]::Center

  $row.Children.Add($avatar) | Out-Null
  $row.Children.Add($nameText) | Out-Null
  $chip.Child = $row
  return $chip
}

function New-TaskCard {
  param($Task)

  $button = New-Object System.Windows.Controls.Button
  $button.Style = $script:Window.FindResource("TaskCardButtonStyle")
  $button.Margin = "0,0,0,10"
  $button.MinHeight = 120

  $layout = New-Object System.Windows.Controls.Grid
  $projectRow = New-Object System.Windows.Controls.RowDefinition
  $projectRow.Height = [System.Windows.GridLength]::Auto
  $titleRow = New-Object System.Windows.Controls.RowDefinition
  $titleRow.Height = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star)
  $footerRow = New-Object System.Windows.Controls.RowDefinition
  $footerRow.Height = [System.Windows.GridLength]::Auto
  $layout.RowDefinitions.Add($projectRow) | Out-Null
  $layout.RowDefinitions.Add($titleRow) | Out-Null
  $layout.RowDefinitions.Add($footerRow) | Out-Null

  $project = New-Object System.Windows.Controls.TextBlock
  $project.FontSize = 12
  $project.Foreground = Get-Brush "#8A475569"
  $project.Text = [string]$Task.project_name
  [System.Windows.Controls.Grid]::SetRow($project, 0)
  $layout.Children.Add($project) | Out-Null

  $title = New-Object System.Windows.Controls.TextBlock
  $title.FontSize = 15
  $title.FontWeight = [System.Windows.FontWeights]::SemiBold
  $title.Foreground = Get-Brush "#0F172A"
  $title.TextWrapping = [System.Windows.TextWrapping]::Wrap
  $title.Margin = "0,10,0,12"
  $title.MaxHeight = 46
  $title.Text = [string]$Task.task_title
  [System.Windows.Controls.Grid]::SetRow($title, 1)
  $layout.Children.Add($title) | Out-Null

  $userChip = New-TaskUserChip -DisplayName ([string]$Task.user_display_name)
  [System.Windows.Controls.Grid]::SetRow($userChip, 2)
  $layout.Children.Add($userChip) | Out-Null

  $button.Content = $layout

  $taskId = [string]$Task.task_id
  $button.Add_Click({
    try {
      Invoke-OverlayApi -Path "/api/overlay/tasks/$taskId/open" -Method "POST" | Out-Null
      Set-ErrorBanner ""
    } catch {
      Set-ErrorBanner (Get-UiText "open_task_failed" $_.Exception.Message)
    }
  }.GetNewClosure())

  return $button
}

function Mark-ConversationsRead {
  $latest = $script:CurrentConversations |
    Where-Object { [string]$_.author_kind -eq "openclaw" } |
    Sort-Object created_at -Descending |
    Select-Object -First 1

  if ($null -eq $latest) {
    return
  }

  $script:OverlayState.last_read_conversation_message_at = [string]$latest.created_at
  Save-State
}

function Render-Conversations {
  $controls.MessagesPanel.Children.Clear()

  if ($script:CurrentConversationViews.Count -eq 0) {
    $empty = New-Object System.Windows.Controls.TextBlock
    $empty.Text = Get-UiText "empty_conversations"
    $empty.Foreground = Get-Brush "#8A475569"
    $empty.Margin = "8,8,8,0"
    $controls.MessagesPanel.Children.Add($empty) | Out-Null
  } else {
    foreach ($messageView in $script:CurrentConversationViews) {
      $controls.MessagesPanel.Children.Add((New-MessageBubble -MessageView $messageView)) | Out-Null
    }
  }

  $controls.MessagesScrollViewer.ScrollToEnd()
  if ($script:IsExpanded -and $script:ActiveTab -eq "conversation") {
    Mark-ConversationsRead
  }
}

function Render-Tasks {
  $controls.TasksPanel.Children.Clear()

  if ($script:CurrentTasks.Count -eq 0) {
    $empty = New-Object System.Windows.Controls.TextBlock
    $empty.Text = Get-UiText "empty_tasks"
    $empty.Foreground = Get-Brush "#8A475569"
    $empty.Margin = "8,8,8,0"
    $controls.TasksPanel.Children.Add($empty) | Out-Null
    return
  }

  foreach ($task in $script:CurrentTasks) {
    $controls.TasksPanel.Children.Add((New-TaskCard -Task $task)) | Out-Null
  }
}

function Ensure-ComposerIme {
  try {
    $controls.ComposerInput.Language = [System.Windows.Markup.XmlLanguage]::GetLanguage("zh-CN")
    [System.Windows.Input.InputMethod]::SetIsInputMethodEnabled($controls.ComposerInput, $true)
    [System.Windows.Input.InputMethod]::SetPreferredImeState($controls.ComposerInput, [System.Windows.Input.InputMethodState]::On)
    [System.Windows.Input.InputMethod]::SetPreferredImeConversionMode($controls.ComposerInput, [System.Windows.Input.ImeConversionModeValues]::Native)
  } catch {
    Write-Log ("Failed to enable IME: {0}" -f $_.Exception.Message)
  }
}

function Focus-Composer {
  if ($script:ActiveTab -ne "conversation") {
    return
  }

  $controls.ComposerInput.Dispatcher.BeginInvoke([action]{
    Ensure-ComposerIme
    $controls.ComposerInput.Focus() | Out-Null
    [System.Windows.Input.Keyboard]::Focus($controls.ComposerInput) | Out-Null
    $controls.ComposerInput.CaretIndex = $controls.ComposerInput.Text.Length
  }) | Out-Null
}

function New-DragContext {
  return @{
    is_active = $false
    moved = $false
    suppress_click = $false
    start_cursor = $null
    start_left = 0
    start_top = 0
  }
}

function Start-WindowDrag {
  param(
    [Parameter(Mandatory = $true)]$Surface,
    [Parameter(Mandatory = $true)][hashtable]$Context
  )

  $Context.is_active = $true
  $Context.moved = $false
  $Context.suppress_click = $false
  $Context.start_cursor = [System.Windows.Forms.Cursor]::Position
  $Context.start_left = [double]$script:Window.Left
  $Context.start_top = [double]$script:Window.Top
  $Surface.CaptureMouse() | Out-Null
}

function Update-WindowDrag {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Context
  )

  if (-not $Context.is_active) {
    return
  }

  $cursor = [System.Windows.Forms.Cursor]::Position
  $deltaX = $cursor.X - $Context.start_cursor.X
  $deltaY = $cursor.Y - $Context.start_cursor.Y
  if (([Math]::Abs($deltaX) -gt 2) -or ([Math]::Abs($deltaY) -gt 2)) {
    $Context.moved = $true
  }

  $workArea = Get-WorkArea
  $nextLeft = [double]($Context.start_left + $deltaX)
  $nextTop = [double]($Context.start_top + $deltaY)
  $maxLeft = [double]($workArea.Right - $script:Window.Width)
  $maxTop = [double]($workArea.Bottom - $script:Window.Height)

  if ($nextLeft -lt $workArea.Left) {
    $nextLeft = [double]$workArea.Left
  }
  if ($nextTop -lt $workArea.Top) {
    $nextTop = [double]$workArea.Top
  }
  if ($nextLeft -gt $maxLeft) {
    $nextLeft = $maxLeft
  }
  if ($nextTop -gt $maxTop) {
    $nextTop = $maxTop
  }

  $script:Window.Left = $nextLeft
  $script:Window.Top = $nextTop
}

function Stop-WindowDrag {
  param(
    [Parameter(Mandatory = $true)]$Surface,
    [Parameter(Mandatory = $true)][hashtable]$Context
  )

  if ($Context.is_active) {
    $Surface.ReleaseMouseCapture()
  }
  $Context.is_active = $false
}

function Get-ParentDependencyObject {
  param([Parameter(Mandatory = $true)]$Node)

  if ($Node -is [System.Windows.Media.Visual] -or $Node -is [System.Windows.Media.Media3D.Visual3D]) {
    return [System.Windows.Media.VisualTreeHelper]::GetParent($Node)
  }

  if ($Node -is [System.Windows.FrameworkContentElement]) {
    return $Node.Parent
  }

  return $null
}

function Test-IsInteractiveDescendant {
  param(
    [Parameter(Mandatory = $true)]$StartNode,
    [Parameter(Mandatory = $true)]$StopNode
  )

  $current = $StartNode
  while ($null -ne $current) {
    if ($current -eq $StopNode) {
      return $false
    }

    if (
      $current -is [System.Windows.Controls.Button] -or
      $current -is [System.Windows.Controls.Primitives.ButtonBase] -or
      $current -is [System.Windows.Controls.Primitives.TextBoxBase] -or
      $current -is [System.Windows.Controls.Primitives.Selector]
    ) {
      return $true
    }

    $current = Get-ParentDependencyObject -Node $current
  }

  return $false
}

function Complete-WindowDrag {
  param(
    [Parameter(Mandatory = $true)]$Surface,
    [Parameter(Mandatory = $true)][hashtable]$Context
  )

  $didMove = [bool]$Context.moved
  Stop-WindowDrag -Surface $Surface -Context $Context
  $Context.moved = $false
  return $didMove
}

function Request-ExpandedStateChange {
  param(
    [Parameter(Mandatory = $true)][bool]$Expanded,
    [Parameter(Mandatory = $true)][string]$Source,
    [switch]$ActivateWindow
  )

  Reset-StaleTransitionIfNeeded

  if ($script:IsTransitioning) {
    Write-Log ("Overlay state change ignored while transitioning: expanded={0}; source={1}." -f $Expanded, $Source)
    return $false
  }

  if ($script:IsExpanded -eq $Expanded) {
    return $false
  }

  Write-Log ("Overlay state change requested: expanded={0}; source={1}." -f $Expanded, $Source)
  Set-ExpandedState -Expanded $Expanded
  if ($Expanded -and $ActivateWindow) {
    $script:Window.Activate() | Out-Null
  }

  return $true
}

function Reset-StaleTransitionIfNeeded {
  if (-not $script:IsTransitioning -or $null -eq $script:TransitionStartedAtUtc) {
    return
  }

  $staleThresholdMs = [double]($script:OverlayAnimation.fade_duration_ms + 500)
  $elapsedMs = ([DateTime]::UtcNow - $script:TransitionStartedAtUtc).TotalMilliseconds
  if ($elapsedMs -lt $staleThresholdMs) {
    return
  }

  Write-Log ("Overlay transition exceeded timeout and is being recovered. elapsed_ms={0:N0}" -f $elapsedMs)
  $script:IsTransitioning = $false
  $script:TransitionStartedAtUtc = $null
  $script:PendingTransitionExpanded = $null
  $controls.ExpandedRoot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)

  if ($script:IsExpanded) {
    Apply-ExpandedVisualState
  } else {
    Apply-CollapsedVisualState
  }
}

function Apply-LocalizedChrome {
  $controls.CollapseButton.Content = Get-UiText "collapse_button"
  $controls.ConversationTabButton.Content = Get-UiText "header_conversation"
  $controls.TasksTabButton.Content = Get-UiText "header_tasks"
  $controls.SendButton.Content = Get-UiText "send_button"
}

function Get-WindowFrameForState {
  param([Parameter(Mandatory = $true)][bool]$Expanded)

  $workArea = Get-WorkArea
  if ($script:OverlayState.window_position) {
    $anchorX = [int]$script:OverlayState.window_position.x
    $anchorY = [int]$script:OverlayState.window_position.y
  } else {
    $defaultAnchor = Get-DefaultCollapsedPosition
    $anchorX = [int]$defaultAnchor.x
    $anchorY = [int]$defaultAnchor.y
  }

  if ($Expanded) {
    $windowX = [int]($anchorX + $script:CollapsedSize - $script:ExpandedWidth)
    $windowY = [int]($anchorY + $script:CollapsedSize - $script:ExpandedHeight)
    if ($windowX -lt $workArea.Left) {
      $windowX = [int]$workArea.Left
    }
    if ($windowY -lt $workArea.Top) {
      $windowY = [int]$workArea.Top
    }
    return @{
      left = [double]$windowX
      top = [double]$windowY
      width = [double]$script:ExpandedWidth
      height = [double]$script:ExpandedHeight
    }
  } else {
    return @{
      left = [double]$anchorX
      top = [double]$anchorY
      width = [double]$script:CollapsedSize
      height = [double]$script:CollapsedSize
    }
  }
}

function Set-WindowPlacement {
  param([Parameter(Mandatory = $true)][bool]$Expanded)

  $frame = Get-WindowFrameForState -Expanded $Expanded
  $script:Window.Width = $frame.width
  $script:Window.Height = $frame.height
  $script:Window.Left = $frame.left
  $script:Window.Top = $frame.top
}

function Set-OverlayRootState {
  param(
    [Parameter(Mandatory = $true)][double]$CollapsedOpacity,
    [Parameter(Mandatory = $true)][double]$ExpandedOpacity,
    [Parameter(Mandatory = $true)][bool]$CollapsedInteractive,
    [Parameter(Mandatory = $true)][bool]$ExpandedInteractive,
    [Parameter(Mandatory = $true)][bool]$CollapsedVisible,
    [Parameter(Mandatory = $true)][bool]$ExpandedVisible
  )

  $controls.CollapsedRoot.Opacity = $CollapsedOpacity
  $controls.ExpandedRoot.Opacity = $ExpandedOpacity
  $controls.CollapsedRoot.IsHitTestVisible = $CollapsedInteractive
  $controls.ExpandedRoot.IsHitTestVisible = $ExpandedInteractive
  $controls.CollapsedRoot.Visibility = if ($CollapsedVisible) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
  $controls.ExpandedRoot.Visibility = if ($ExpandedVisible) { [System.Windows.Visibility]::Visible } else { [System.Windows.Visibility]::Collapsed }
}

function Apply-CollapsedVisualState {
  Set-WindowPlacement -Expanded $false
  Set-OverlayRootState -CollapsedOpacity 1 -ExpandedOpacity 0 -CollapsedInteractive $true -ExpandedInteractive $false -CollapsedVisible $true -ExpandedVisible $false
}

function Apply-ExpandedVisualState {
  Set-WindowPlacement -Expanded $true
  Set-OverlayRootState -CollapsedOpacity 0 -ExpandedOpacity 1 -CollapsedInteractive $false -ExpandedInteractive $true -CollapsedVisible $false -ExpandedVisible $true
}

function Ensure-TransitionTimer {
  if ($null -ne $script:TransitionTimer) {
    return
  }

  $script:TransitionTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:TransitionTimer.Interval = [TimeSpan]::FromMilliseconds($script:OverlayAnimation.fade_duration_ms + 24)
  $script:TransitionTimer.Add_Tick({
    $script:TransitionTimer.Stop()
    $controls.ExpandedRoot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)

    $targetExpanded = $script:PendingTransitionExpanded
    $script:PendingTransitionExpanded = $null
    if ($null -eq $targetExpanded) {
      return
    }

    try {
      if ([bool]$targetExpanded) {
        Apply-ExpandedVisualState
        if ($script:ActiveTab -eq "conversation") {
          Mark-ConversationsRead
          Focus-Composer
        }
        Write-Log "Overlay expand transition completed."
      } else {
        Apply-CollapsedVisualState
        Write-Log "Overlay collapse transition completed."
      }
    } catch {
      Write-Log ("Overlay transition finalizer failed: {0}" -f $_.Exception.Message)
      try {
        Apply-CollapsedVisualState
      } catch {
        Write-Log ("Overlay fallback collapse failed: {0}" -f $_.Exception.Message)
      }
    } finally {
      $script:IsTransitioning = $false
      $script:TransitionStartedAtUtc = $null
    }
  })
}

function Start-ExpandedRootOpacityTransition {
  param(
    [Parameter(Mandatory = $true)][double]$From,
    [Parameter(Mandatory = $true)][double]$To,
    [Parameter(Mandatory = $true)][bool]$Expanded
  )

  Ensure-TransitionTimer

  $script:TransitionTimer.Stop()
  $script:PendingTransitionExpanded = $Expanded

  $animation = New-Object System.Windows.Media.Animation.DoubleAnimation
  $animation.From = $From
  $animation.To = $To
  $animation.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds($script:OverlayAnimation.fade_duration_ms))
  $animation.FillBehavior = [System.Windows.Media.Animation.FillBehavior]::HoldEnd
  $controls.ExpandedRoot.Opacity = $From
  $controls.ExpandedRoot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $animation)
  $script:TransitionTimer.Start()
}

function Set-ActiveTab {
  param([Parameter(Mandatory = $true)][ValidateSet("conversation", "tasks")][string]$TabName)

  $script:ActiveTab = $TabName
  $script:OverlayState.last_tab = $TabName
  Save-State

  if ($TabName -eq "conversation") {
    $controls.ConversationPane.Visibility = [System.Windows.Visibility]::Visible
    $controls.TasksPane.Visibility = [System.Windows.Visibility]::Collapsed
    $controls.HeaderTitle.Text = Get-UiText "header_conversation"
    Set-HeaderConnectionIndicator -Connected (Get-CurrentOpenClawConnectedState) -Visible $true
    $controls.ConversationTabButton.Background = Get-Brush "#FFFFFFFF"
    $controls.ConversationTabButton.Foreground = Get-Brush "#0F172A"
    $controls.TasksTabButton.Background = Get-Brush "#F2FFFFFF"
    $controls.TasksTabButton.Foreground = Get-Brush "#475569"
    Render-Conversations
    Focus-Composer
  } else {
    $controls.ConversationPane.Visibility = [System.Windows.Visibility]::Collapsed
    $controls.TasksPane.Visibility = [System.Windows.Visibility]::Visible
    $controls.HeaderTitle.Text = Get-UiText "header_tasks"
    Set-HeaderConnectionIndicator -Connected (Get-CurrentOpenClawConnectedState) -Visible $false
    $controls.TasksTabButton.Background = Get-Brush "#FFFFFFFF"
    $controls.TasksTabButton.Foreground = Get-Brush "#0F172A"
    $controls.ConversationTabButton.Background = Get-Brush "#F2FFFFFF"
    $controls.ConversationTabButton.Foreground = Get-Brush "#475569"
    Render-Tasks
  }
}

function Get-CurrentOpenClawConnectedState {
  if ($null -eq $script:CurrentBootstrap) {
    return $false
  }

  return [bool]$script:CurrentBootstrap.openclaw_connected
}

function Get-CurrentOpenClawStatusLabel {
  if ($null -eq $script:CurrentBootstrap -or $null -eq $script:CurrentBootstrap.openclaw_status) {
    return (Get-UiText "openclaw_not_configured")
  }

  if ($script:CurrentBootstrap.openclaw_status.status_label) {
    return [string]$script:CurrentBootstrap.openclaw_status.status_label
  }

  return (Get-UiText "openclaw_not_configured")
}

function Persist-CollapsedAnchor {
  if ($script:IsTransitioning) {
    return
  }

  if ($script:IsExpanded) {
    $script:OverlayState.window_position = @{
      x = [int]($script:Window.Left + $script:Window.Width - $script:CollapsedSize)
      y = [int]($script:Window.Top + $script:Window.Height - $script:CollapsedSize)
    }
  } else {
    $script:OverlayState.window_position = @{
      x = [int]$script:Window.Left
      y = [int]$script:Window.Top
    }
  }
  Save-State
}

function Set-ExpandedState {
  param(
    [Parameter(Mandatory = $true)][bool]$Expanded,
    [switch]$Immediate
  )

  if ($script:IsTransitioning) {
    return
  }

  if ($Immediate) {
    $script:IsExpanded = $Expanded
    if ($Expanded) {
      Apply-ExpandedVisualState
      if ($script:ActiveTab -eq "conversation") {
        Mark-ConversationsRead
        Focus-Composer
      }
    } else {
      Apply-CollapsedVisualState
    }
    return
  }

  if ($script:IsExpanded -eq $Expanded) {
    return
  }

  $script:IsTransitioning = $true
  $script:TransitionStartedAtUtc = [DateTime]::UtcNow
  $script:IsExpanded = $Expanded

  if ($Expanded) {
    Set-WindowPlacement -Expanded $true
    Set-OverlayRootState -CollapsedOpacity 0 -ExpandedOpacity 0 -CollapsedInteractive $false -ExpandedInteractive $false -CollapsedVisible $false -ExpandedVisible $true
    Write-Log "Overlay expand transition started."
    Start-ExpandedRootOpacityTransition -From 0 -To 1 -Expanded $true
  } else {
    Set-OverlayRootState -CollapsedOpacity 0 -ExpandedOpacity 1 -CollapsedInteractive $false -ExpandedInteractive $false -CollapsedVisible $false -ExpandedVisible $true
    Write-Log "Overlay collapse transition started."
    Start-ExpandedRootOpacityTransition -From 1 -To 0 -Expanded $false
  }
}

function Refresh-Bootstrap {
  try {
    $script:CurrentBootstrap = Invoke-OverlayApi -Path "/api/overlay/bootstrap"
    Update-OrbState

    $openclawConnected = Get-CurrentOpenClawConnectedState

    $controls.ComposerInput.IsEnabled = $openclawConnected
    $controls.SendButton.IsEnabled = $openclawConnected
    if ($script:ActiveTab -eq "conversation") {
      Set-HeaderConnectionIndicator -Connected $openclawConnected -Visible $true
    }

    if ($openclawConnected) {
      Ensure-ComposerIme
      Set-ErrorBanner ""
    } else {
      Set-ErrorBanner (Get-UiText "openclaw_status" (Get-CurrentOpenClawStatusLabel))
    }
  } catch {
    if ($script:ActiveTab -eq "conversation") {
      Set-HeaderConnectionIndicator -Connected $false -Visible $true
    }
    Set-ErrorBanner (Get-UiText "connect_failed" $_.Exception.Message)
  }
}

function Refresh-Conversations {
  try {
    $result = Invoke-OverlayApi -Path "/api/overlay/conversations"
    $script:CurrentConversations = @($result.messages)
    $script:CurrentConversationViews = @($result.message_views)
    Render-Conversations
    Set-ErrorBanner ""
  } catch {
    Set-ErrorBanner (Get-UiText "load_conversations_failed" $_.Exception.Message)
  }
}

function Refresh-Tasks {
  try {
    $result = Invoke-OverlayApi -Path "/api/overlay/tasks/current"
    $script:CurrentTasks = @($result.tasks)
    Render-Tasks
    Set-ErrorBanner ""
  } catch {
    Set-ErrorBanner (Get-UiText "load_tasks_failed" $_.Exception.Message)
  }
}

function Send-ConversationMessage {
  $body = $controls.ComposerInput.Text
  if ($null -eq $body -or [string]::IsNullOrWhiteSpace($body.Trim())) {
    return
  }

  try {
    $result = Invoke-OverlayApi -Path "/api/overlay/conversations/messages" -Method "POST" -Body @{ body = $body.Trim() }
    $script:CurrentConversations = @($result.messages)
    $script:CurrentConversationViews = @($result.message_views)
    $controls.ComposerInput.Clear()
    Render-Conversations
    Refresh-Bootstrap
    Focus-Composer
    Set-ErrorBanner ""
  } catch {
    Set-ErrorBanner (Get-UiText "send_failed" $_.Exception.Message)
  }
}

function Open-Platform {
  $destination = $PlatformWebOrigin
  if ($script:OverlayState.last_platform_url) {
    $destination = [string]$script:OverlayState.last_platform_url
  }
  Start-Process $destination | Out-Null
}

Ensure-Directory -Path $OverlayDataRoot
Ensure-Directory -Path (Split-Path -Parent $ReadyFile)
Ensure-Directory -Path (Split-Path -Parent $LogFile)
Initialize-OverlayMutex
$script:HttpClient = New-OverlayHttpClient

$script:OverlayState = Load-State
if ($script:OverlayState.last_tab) {
  $script:ActiveTab = [string]$script:OverlayState.last_tab
}

[xml]$xaml = Get-Content -LiteralPath (Join-Path $PSScriptRoot "OverlayWindow.xaml") -Raw -Encoding utf8
$reader = New-Object System.Xml.XmlNodeReader $xaml
$script:Window = [Windows.Markup.XamlReader]::Load($reader)

$controls = @{
  CollapsedRoot = $script:Window.FindName("CollapsedRoot")
  ExpandedRoot = $script:Window.FindName("ExpandedRoot")
  OrbButton = $script:Window.FindName("OrbButton")
  OrbHalo = $script:Window.FindName("OrbHalo")
  OrbBorder = $script:Window.FindName("OrbBorder")
  OrbSurface = $script:Window.FindName("OrbSurface")
  OrbAtmosphere = $script:Window.FindName("OrbAtmosphere")
  OrbSurfaceGlow = $script:Window.FindName("OrbSurfaceGlow")
  OrbPrimaryMeridianA = $script:Window.FindName("OrbPrimaryMeridianA")
  OrbPrimaryMeridianB = $script:Window.FindName("OrbPrimaryMeridianB")
  OrbPrimaryMeridianC = $script:Window.FindName("OrbPrimaryMeridianC")
  OrbSecondaryLatitudeA = $script:Window.FindName("OrbSecondaryLatitudeA")
  OrbSecondaryLatitudeB = $script:Window.FindName("OrbSecondaryLatitudeB")
  OrbSecondaryLatitudeC = $script:Window.FindName("OrbSecondaryLatitudeC")
  OrbHighlightArcPrimary = $script:Window.FindName("OrbHighlightArcPrimary")
  OrbHighlightArcSecondary = $script:Window.FindName("OrbHighlightArcSecondary")
  OrbOrbitPrimary = $script:Window.FindName("OrbOrbitPrimary")
  OrbOrbitPrimaryDot = $script:Window.FindName("OrbOrbitPrimaryDot")
  OrbOrbitSecondary = $script:Window.FindName("OrbOrbitSecondary")
  OrbOrbitSecondaryDot = $script:Window.FindName("OrbOrbitSecondaryDot")
  OrbPrimaryWireRotate = $script:Window.FindName("OrbPrimaryWireRotate")
  OrbSecondaryWireRotate = $script:Window.FindName("OrbSecondaryWireRotate")
  OrbPrimaryOrbitRotate = $script:Window.FindName("OrbPrimaryOrbitRotate")
  OrbSecondaryOrbitRotate = $script:Window.FindName("OrbSecondaryOrbitRotate")
  UnreadBadge = $script:Window.FindName("UnreadBadge")
  UnreadBadgeText = $script:Window.FindName("UnreadBadgeText")
  HeaderDragGrip = $script:Window.FindName("HeaderDragGrip")
  HeaderStatusDot = $script:Window.FindName("HeaderStatusDot")
  HeaderTitle = $script:Window.FindName("HeaderTitle")
  CollapseButton = $script:Window.FindName("CollapseButton")
  ConversationTabButton = $script:Window.FindName("ConversationTabButton")
  TasksTabButton = $script:Window.FindName("TasksTabButton")
  ConversationPane = $script:Window.FindName("ConversationPane")
  TasksPane = $script:Window.FindName("TasksPane")
  MessagesScrollViewer = $script:Window.FindName("MessagesScrollViewer")
  MessagesPanel = $script:Window.FindName("MessagesPanel")
  ComposerInput = $script:Window.FindName("ComposerInput")
  SendButton = $script:Window.FindName("SendButton")
  TasksPanel = $script:Window.FindName("TasksPanel")
  ErrorBanner = $script:Window.FindName("ErrorBanner")
  ErrorText = $script:Window.FindName("ErrorText")
}

Apply-LocalizedChrome
Ensure-TransitionTimer
Update-OrbState

$script:Window.Dispatcher.Add_UnhandledException({
  Write-Log ("Unhandled overlay dispatcher exception: {0}" -f $_.Exception.Message)
  $_.Handled = $true
  $script:IsTransitioning = $false
  $script:TransitionStartedAtUtc = $null
  try {
    Apply-CollapsedVisualState
  } catch {
    Write-Log ("Dispatcher recovery failed: {0}" -f $_.Exception.Message)
  }
})

$orbDragContext = New-DragContext
$headerDragContext = New-DragContext

$controls.OrbButton.Add_PreviewMouseLeftButtonDown({
  Start-WindowDrag -Surface $controls.OrbButton -Context $orbDragContext
})

$controls.OrbButton.Add_MouseMove({
  if ([System.Windows.Input.Mouse]::LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
    Update-WindowDrag -Context $orbDragContext
  }
})

$controls.OrbButton.Add_PreviewMouseLeftButtonUp({
  $didMove = Complete-WindowDrag -Surface $controls.OrbButton -Context $orbDragContext
  if ($didMove) {
    $orbDragContext.suppress_click = $true
    return
  }
  $orbDragContext.suppress_click = $true
  $_.Handled = $true
  [void](Request-ExpandedStateChange -Expanded $true -Source "orb-mouse-release" -ActivateWindow)
})

$controls.OrbButton.Add_Click({
  if ($orbDragContext.suppress_click) {
    $orbDragContext.suppress_click = $false
    return
  }
  [void](Request-ExpandedStateChange -Expanded $true -Source "orb-click" -ActivateWindow)
})

$controls.OrbButton.Add_MouseLeave({
  if ([System.Windows.Input.Mouse]::LeftButton -ne [System.Windows.Input.MouseButtonState]::Pressed) {
    [void](Complete-WindowDrag -Surface $controls.OrbButton -Context $orbDragContext)
  }
})

$controls.HeaderDragGrip.Add_PreviewMouseLeftButtonDown({
  if (Test-IsInteractiveDescendant -StartNode $_.OriginalSource -StopNode $controls.HeaderDragGrip) {
    return
  }
  Start-WindowDrag -Surface $controls.HeaderDragGrip -Context $headerDragContext
})

$controls.HeaderDragGrip.Add_MouseMove({
  if ([System.Windows.Input.Mouse]::LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
    Update-WindowDrag -Context $headerDragContext
  }
})

$controls.HeaderDragGrip.Add_PreviewMouseLeftButtonUp({
  [void](Complete-WindowDrag -Surface $controls.HeaderDragGrip -Context $headerDragContext)
})

$controls.CollapseButton.Add_Click({
  [void](Request-ExpandedStateChange -Expanded $false -Source "collapse-button")
})
$controls.ConversationTabButton.Add_Click({ Set-ActiveTab -TabName "conversation" })
$controls.TasksTabButton.Add_Click({ Set-ActiveTab -TabName "tasks" })
$controls.SendButton.Add_Click({ Send-ConversationMessage })

$controls.ComposerInput.Add_GotKeyboardFocus({
  Ensure-ComposerIme
})

$controls.ComposerInput.Add_PreviewKeyDown({
  if ($_.Key -eq [System.Windows.Input.Key]::Enter -and [System.Windows.Input.Keyboard]::Modifiers -eq [System.Windows.Input.ModifierKeys]::Control) {
    $_.Handled = $true
    Send-ConversationMessage
  }
})

$script:Window.Add_LocationChanged({ Persist-CollapsedAnchor })

$script:Window.Add_Closing({
  Write-Log ("Overlay window closing requested. is_quitting={0}" -f $script:IsQuitting)
  if (-not $script:IsQuitting) {
    $_.Cancel = $true
    $script:Window.Hide()
  }
})

$script:Window.Add_StateChanged({
  if ($script:Window.WindowState -eq [System.Windows.WindowState]::Minimized) {
    $script:Window.WindowState = [System.Windows.WindowState]::Normal
    $script:Window.Hide()
  }
})

$script:NotifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:NotifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$script:NotifyIcon.Text = "Flow Overlay"
$script:NotifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$menuOpenOverlay = $contextMenu.Items.Add((Get-UiText "tray_open_overlay"))
$menuOpenPlatform = $contextMenu.Items.Add((Get-UiText "tray_open_platform"))
$menuReconnect = $contextMenu.Items.Add((Get-UiText "tray_reconnect"))
$contextMenu.Items.Add("-") | Out-Null
$menuExit = $contextMenu.Items.Add((Get-UiText "tray_exit"))
$script:NotifyIcon.ContextMenuStrip = $contextMenu

$menuOpenOverlay.Add_Click({
  $script:Window.Show()
  $script:Window.Activate() | Out-Null
  if ($script:IsExpanded) {
    Focus-Composer
  }
})

$menuOpenPlatform.Add_Click({ Open-Platform })

$menuReconnect.Add_Click({
  Refresh-Bootstrap
  Refresh-Conversations
  Refresh-Tasks
})

$menuExit.Add_Click({
  $script:IsQuitting = $true
  $script:NotifyIcon.Visible = $false
  $script:NotifyIcon.Dispose()
  Remove-OwnedReadyFile
  $script:Window.Close()
})

$script:NotifyIcon.Add_MouseClick({
  if ($_.Button -ne [System.Windows.Forms.MouseButtons]::Left) {
    return
  }
  if (-not $script:Window.IsVisible) {
    $script:Window.Show()
    $script:Window.Activate() | Out-Null
    if ($script:IsExpanded) {
      Focus-Composer
    }
    return
  }
  if ($script:IsExpanded) {
    [void](Request-ExpandedStateChange -Expanded $false -Source "tray-icon")
  } else {
    [void](Request-ExpandedStateChange -Expanded $true -Source "tray-icon" -ActivateWindow)
  }
})

$bootstrapTimer = New-Object System.Windows.Threading.DispatcherTimer
$bootstrapTimer.Interval = [TimeSpan]::FromSeconds(5)
$bootstrapTimer.Add_Tick({ Refresh-Bootstrap })

$conversationTimer = New-Object System.Windows.Threading.DispatcherTimer
$conversationTimer.Interval = [TimeSpan]::FromSeconds(3)
$conversationTimer.Add_Tick({ Refresh-Conversations })

$tasksTimer = New-Object System.Windows.Threading.DispatcherTimer
$tasksTimer.Interval = [TimeSpan]::FromSeconds(10)
$tasksTimer.Add_Tick({ Refresh-Tasks })

Set-ExpandedState -Expanded $false -Immediate
Set-ActiveTab -TabName $script:ActiveTab
Refresh-Bootstrap
Refresh-Conversations
Refresh-Tasks

$bootstrapTimer.Start()
$conversationTimer.Start()
$tasksTimer.Start()

Set-Content -LiteralPath $ReadyFile -Value (ConvertTo-Json @{
  pid = $PID
  owner_user_id = $OwnerUserId
  ui_port = $UiPort
  host = "windows-native"
}) -Encoding utf8

Write-Log ("Windows native overlay started for {0} on port {1}." -f $OwnerUserId, $UiPort)
$script:Window.Show()
$script:Window.Activate() | Out-Null
if ($script:IsExpanded) {
  Focus-Composer
}

try {
  [void][System.Windows.Threading.Dispatcher]::Run()
} finally {
  if ($script:HttpClient) {
    $script:HttpClient.Dispose()
  }
  if ($script:NotifyIcon) {
    $script:NotifyIcon.Visible = $false
    $script:NotifyIcon.Dispose()
  }
  if ($script:OverlayMutex) {
    $script:OverlayMutex.ReleaseMutex() | Out-Null
    $script:OverlayMutex.Dispose()
  }
  Remove-OwnedReadyFile
  Write-Log ("Windows native overlay exited for {0}." -f $OwnerUserId)
}
