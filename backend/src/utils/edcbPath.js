const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * 起動中の EDCB プロセスからインストールディレクトリを自動取得
 */
function getEdcbDir() {
  try {
    // Get-CimInstance を使い、エラーが発生しても黙らせてパスを取得する
    const psCommand = `powershell -NoProfile -Command "$proc = Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(EpgTimerSrv|EpgTimer|EpgDataCap_Bon)\\.exe$' }; if ($proc) { $proc.ExecutablePath | Select-Object -First 1 }"`;
    
    const stdout = execSync(psCommand, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    if (stdout) {
      // 取得できたフルパスからディレクトリを取得
      const edcbDir = path.dirname(stdout.trim());
      console.log(`[EDCB Path] Detected active EDCB directory: ${edcbDir}`);
      return edcbDir;
    }
  } catch (err) {
    console.warn('[EDCB Path] Failed to detect via active process:', err.message);
  }

  // 自動検出できなかった場合のフォールバック（環境変数または固定デフォルト）
  return process.env.EDCB_DIR || 'C:\\EDCB';
}

/**
 * ChSet5.txt (または ChSet4.txt) のフルパスを取得
 */
function getChSetFilePath() {
  const baseDir = getEdcbDir();
  
  const chSet5 = path.join(baseDir, 'Setting', 'ChSet5.txt');
  const chSet4 = path.join(baseDir, 'Setting', 'ChSet4.txt');

  if (fs.existsSync(chSet5)) return chSet5;
  if (fs.existsSync(chSet4)) return chSet4;

  return chSet5;
}

module.exports = { getEdcbDir, getChSetFilePath };