@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

echo ========================================
echo   TV Local Streaming Server Starter
echo ========================================
echo.

:: 1. Node.js のチェック
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js が見つかりません。
    echo Node.js をインストールして PATH を通してから再実行してください。
    echo URL: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: 2. FFmpeg のチェック
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] FFmpeg が見つかりません。
    echo FFmpeg をインストールして PATH を通してから再実行してください。
    echo.
    pause
    exit /b 1
)

:: 3. EDCB (NWポート 4510) のチェック
echo Checking EDCB Network Service (Port 4510)...
powershell -Command "if (-not (Test-NetConnection -ComputerName 127.0.0.1 -Port 4510 -InformationLevel Quiet)) { exit 1 }"
if %errorlevel% neq 0 (
    echo [ERROR] EDCB（Port 4510）に接続できませんでした。
    echo.
    echo 以下を確認してください:
    echo  1. EpgTimerSrv / EpgTimer が起動しているか
    echo  2. EDCBの設定で「NW接続」が許可されているか
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js, FFmpeg, and EDCB are ready!
echo Starting Tray Manager...
echo.

:: 4. タスクトレイマネージャーの起動
powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "tray_manager.ps1"