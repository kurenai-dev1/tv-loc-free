Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

$global:nodeProcess = $null

# タスクトレイアイコン作成
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$iconPath = Join-Path $scriptDir "TvLocFree.ico"
if (Test-Path $iconPath) {
    $notifyIcon.Icon = New-Object System.Drawing.Icon($iconPath)
} else {
    # .ico ファイルが無い場合のフォールバック（標準アイコン）
    $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
}
$notifyIcon.Visible = $true
$notifyIcon.Text = "TV Local Streaming Server"

# 右クリックメニューの作成
$contextMenu = New-Object System.Windows.Forms.ContextMenu
$itemStart = New-Object System.Windows.Forms.MenuItem("⇒ Start Server")
$itemStop  = New-Object System.Windows.Forms.MenuItem("■ Stop Server")
$itemExit  = New-Object System.Windows.Forms.MenuItem("× Exit")

$itemStop.Enabled = $false

# Start 処理
$itemStart.add_Click({
    if ($global:nodeProcess -eq $null -or $global:nodeProcess.HasExited) {
        # node server.js を別ウィンドウ（コンソール表示あり）で起動
        $global:nodeProcess = Start-Process "node" -ArgumentList "server.js" -WorkingDirectory $scriptDir -PassThru
        $itemStart.Enabled = $false
        $itemStop.Enabled = $true
        $notifyIcon.ShowBalloonTip(1000, "TV Server", "Server Started!", [System.Windows.Forms.ToolTipIcon]::Info)
    }
})

# Stop 処理
$itemStop.add_Click({
    if ($global:nodeProcess -and -not $global:nodeProcess.HasExited) {
        Stop-Process -Id $global:nodeProcess.Id -Force -ErrorAction SilentlyContinue
        $global:nodeProcess = $null
        $itemStart.Enabled = $true
        $itemStop.Enabled = $false
        $notifyIcon.ShowBalloonTip(1000, "TV Server", "Server Stopped.", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
})

# Exit 処理
$itemExit.add_Click({
    if ($global:nodeProcess -and -not $global:nodeProcess.HasExited) {
        Stop-Process -Id $global:nodeProcess.Id -Force -ErrorAction SilentlyContinue
    }
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$contextMenu.MenuItems.Add($itemStart) | Out-Null
$contextMenu.MenuItems.Add($itemStop)  | Out-Null
$contextMenu.MenuItems.Add($itemExit)  | Out-Null
$notifyIcon.ContextMenu = $contextMenu

# 起動時に自動で Server もスタート
$itemStart.PerformClick()

# タスクトレイ常駐ループ開始
[System.Windows.Forms.Application]::Run()