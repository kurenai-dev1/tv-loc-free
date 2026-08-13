const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const { openChannel, closeChannel } = require('./edcbControl');

let activeProcess = null;
let currentChannelKey = null;
let isStarting = false;
let isStopping = false;

let heartbeatTimer = null;
let lastHeartbeatTime = Date.now();

// ハートビートを受け取った時に呼ぶ関数
function updateHeartbeat() {
  lastHeartbeatTime = Date.now();
}

// ハートビート監視タイマーの開始
function startHeartbeatMonitor() {
  stopHeartbeatMonitor(); // 二重起動防止
  lastHeartbeatTime = Date.now();

  heartbeatTimer = setInterval(async () => {
    // 最後のハートビートから 15秒 以上経過していたら無効とみなして自動停止
    if (Date.now() - lastHeartbeatTime > 15000) {
      console.log('[Heartbeat] Timeout detected (UI dead or closed). Stopping stream...');
      stopHeartbeatMonitor();
      await stopStream();
    }
  }, 5000); // 5秒ごとにチェック
}

function stopHeartbeatMonitor() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

if (!fs.existsSync(config.HLS_DIR)) {
  fs.mkdirSync(config.HLS_DIR, { recursive: true });
}

function cleanHlsDir() {
  try {
    if (fs.existsSync(config.HLS_DIR)) {
      const files = fs.readdirSync(config.HLS_DIR);
      for (const file of files) {
        if (file.endsWith('.m3u8') || file.endsWith('.ts')) {
          fs.unlinkSync(path.join(config.HLS_DIR, file));
        }
      }
      console.log('[HLS Cleanup] Old segment and playlist files removed.');
    }
  } catch (err) {
    console.error('[HLS Cleanup Error]', err.message);
  }
}

async function findSendTsPipe(timeoutMs = 5000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const files = fs.readdirSync('\\\\.\\pipe\\');
      const targetPipes = files.filter(file => file.startsWith('SendTSTCP_'));

      if (targetPipes.length > 0) {
        const selectedPipe = targetPipes[targetPipes.length - 1];
        console.log(`[Pipe Finder] Found pipe: ${selectedPipe}`);
        return `\\\\.\\pipe\\${selectedPipe}`;
      }
    } catch (err) {}

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  throw new Error('Timeout waiting for SendTSTCP_* pipe');
}

/**
 * master.m3u8 が生成され、サイズが 0 より大きくなるまで安全に待機
 */
async function waitForFile(filePath, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
          return true;
        }
      }
    } catch (e) {
      // ファイルロック等のタイミングエラーはスルーして再試行
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timeout waiting for file generation: ${filePath}`);
}

async function startStream(onid, tsid, sid, callback) {
  const channelKey = `${onid}-${tsid}-${sid}`;

  // 既に同じチャンネルが稼働中なら既存のプレイリストを返す
  if (activeProcess && currentChannelKey === channelKey) {
    console.log('[ffmpeg] Stream already running for this channel.');
    return callback(null, '/hls/master.m3u8');
  }

  // 二重起動（リクエスト連打など）をガード
  if (isStarting) {
    console.log('[ffmpeg] Stream is currently starting, skipping duplicate request...');
    return callback(null, '/hls/master.m3u8');
  }

  isStarting = true;

  try {
    // 既存ストリームがあればクリーンアップ（チャンネル切替時など）
    await stopStream();

    console.log(`Sending NWTV set channel command: ONID=${onid}, TSID=${tsid}, SID=${sid}`);
    await openChannel(onid, tsid, sid);
    currentChannelKey = channelKey;

    console.log('[ffmpeg] Searching for SendTSTCP_* pipe...');
    const pipePath = await findSendTsPipe(5000);
    console.log(`[ffmpeg] Using pipe: ${pipePath}`);

    // パイプ接続安定のためわずかに待機
    await new Promise(resolve => setTimeout(resolve, 500));

    const ffmpegArgs = [
      '-y',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-i', pipePath,

      // 720p Stream (v:0, a:0)
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v:0', 'libx264', '-preset:v:0', 'ultrafast', '-b:v:0', '2.5M', '-s:v:0', '1280x720',
      '-c:a:0', 'aac', '-b:a:0', '128k',

      // 480p Stream (v:1, a:1)
      '-map', '0:v:0', '-map', '0:a:0',
      '-c:v:1', 'libx264', '-preset:v:1', 'ultrafast', '-b:v:1', '1M', '-s:v:1', '854x480',
      '-c:a:1', 'aac', '-b:a:1', '96k',

      // HLS オプション設定
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '10',
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
      '-var_stream_map', 'v:0,a:0 v:1,a:1',
      '-master_pl_name', 'master.m3u8',
      path.join(config.HLS_DIR, 'stream_%v.m3u8')
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    activeProcess = ffmpeg;

    ffmpeg.stderr.on('data', (data) => {
      // デバッグ時に関心のあるログを確認可能
      // console.log(`[ffmpeg stderr] ${data.toString()}`);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[ffmpeg] Process exited with code: ${code}`);
      activeProcess = null;
    });

    const masterPath = path.join(config.HLS_DIR, 'master.m3u8');
    console.log('[ffmpeg] Waiting for master.m3u8 creation...');
    await waitForFile(masterPath, 15000);
    console.log('[ffmpeg] master.m3u8 generated successfully.');

    callback(null, '/hls/master.m3u8');

  } catch (err) {
    console.error('Failed to start stream:', err.message);
    await stopStream();
    callback(err);
  } finally {
    isStarting = false;
  }
}

async function stopStream() {
  if (isStopping) return;
  isStopping = true;

  try {
    if (activeProcess) {
      console.log('[ffmpeg] Killing active process...');
      const proc = activeProcess;
      activeProcess = null;
      proc.kill('SIGKILL');
    }
    currentChannelKey = null;

    await closeChannel();
    cleanHlsDir();
  } catch (err) {
    console.error('[stopStream Error]', err.message);
  } finally {
    isStopping = false;
  }
}

module.exports = { startStream, stopStream, updateHeartbeat };