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

/**
 * エンコーダーおよび設定された画質リストに応じた FFmpeg 引数（Stream マッピング・オプション）を動的に生成
 */
function buildDynamicFFmpegArgs() {
  const isQsv = config.FFMPEG_ENCODER === 'qsv';
  const qualities = config.ACTIVE_QUALITIES; // 例: ['720p', '480p', '360p']
  
  console.log(`[FFmpeg] Target qualities: ${qualities.join(', ')} (Encoder: ${isQsv ? 'QSV' : 'CPU'})`);

  const streamMapParts = [];
  const encodeArgs = [];

  qualities.forEach((qKey, index) => {
    const profile = config.QUALITY_PROFILES[qKey];
    if (!profile) return;

    // 入力TSストリームの 映像0:a:0 と 音声0:a:0 を各ストリームへマップ
    encodeArgs.push('-map', '0:v:0', '-map', '0:a:0');

    // 映像オプションの生成
    if (isQsv) {
      encodeArgs.push(
        `-c:v:${index}`, 'h264_qsv',
        `-preset:v:${index}`, 'veryfast',
        `-b:v:${index}`, profile.videoBitrate,
        `-s:v:${index}`, `${profile.width}x${profile.height}`
      );
    } else {
      encodeArgs.push(
        `-c:v:${index}`, 'libx264',
        `-preset:v:${index}`, 'ultrafast',
        `-b:v:${index}`, profile.videoBitrate,
        `-s:v:${index}`, `${profile.width}x${profile.height}`
      );
    }

    // 音声オプションの生成
    encodeArgs.push(
      `-c:a:${index}`, 'aac',
      `-b:a:${index}`, profile.audioBitrate
    );

    // var_stream_map 用のエントリを作成 (例: "v:0,a:0")
    streamMapParts.push(`v:${index},a:${index}`);
  });

  return {
    encodeArgs,
    varStreamMap: streamMapParts.join(' '), // 例: "v:0,a:0 v:1,a:1 v:2,a:2"
  };
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

  // 1. 既に同じチャンネルが稼働中なら既存のプレイリストを返す
  if (activeProcess && currentChannelKey === channelKey) {
    console.log('[ffmpeg] Stream already running for this channel.');
    return callback(null, '/hls/master.m3u8');
  }

  // 2. 二重起動（リクエスト連打など）をガード
  if (isStarting) {
    console.log('[ffmpeg] Stream is currently starting, skipping duplicate request...');
    return callback(null, '/hls/master.m3u8');
  }

  isStarting = true;

  try {
    // チャンネル切り替えの判定
    const isChannelChange = activeProcess !== null && currentChannelKey !== channelKey;

    if (isChannelChange) {
      console.log(`[ffmpeg] Channel change detected: ${currentChannelKey} -> ${channelKey}`);
      if (activeProcess) {
        const proc = activeProcess;
        activeProcess = null;
        proc.kill('SIGKILL');
      }
    } else if (!activeProcess) {
      // 完全新規起動時のみ HLS キャッシュをリセット
      cleanHlsDir();
    }

    console.log(`Sending NWTV set channel command: ONID=${onid}, TSID=${tsid}, SID=${sid}`);
    await openChannel(onid, tsid, sid);
    currentChannelKey = channelKey;

    console.log('[ffmpeg] Searching for SendTSTCP_* pipe...');
    const pipePath = await findSendTsPipe(5000);
    console.log(`[ffmpeg] Using pipe: ${pipePath}`);

    // パイプ接続安定のためわずかに待機
    await new Promise(resolve => setTimeout(resolve, 500));

    // 動的に FFmpeg 引数を生成
    const dynamicConfig = buildDynamicFFmpegArgs();

    const ffmpegArgs = [
      '-y',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-i', pipePath,

      // 動的生成されたマップおよびエンコードパラメータ
      ...dynamicConfig.encodeArgs,

      // HLS オプション設定
      '-f', 'hls',
      '-hls_time', '2',
      '-g', '60',
      '-keyint_min', '60',
      '-sc_threshold', '0',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+omit_endlist+independent_segments',
      '-var_stream_map', dynamicConfig.varStreamMap,
      '-master_pl_name', 'master.m3u8',
      path.join(config.HLS_DIR, 'stream_%v.m3u8')
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    activeProcess = ffmpeg;

    // ハートビート監視を開始
    startHeartbeatMonitor();

    ffmpeg.stderr.on('data', (data) => {
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

/**
 * FFmpeg プロセスおよび EDCB チューナーを完全に停止する
 */
async function stopStream() {
  if (isStopping) {
    console.log('[stopStream] Already stopping, skipping duplicate call.');
    return;
  }
  isStopping = true;

  try {
    console.log('[stopStream] Stopping stream and releasing tuner...');

    // 1. ハートビート監視の停止
    stopHeartbeatMonitor();

    // 2. FFmpeg プロセスの強制終了
    if (activeProcess) {
      console.log(`[ffmpeg] Killing active process PID: ${activeProcess.pid}`);
      const proc = activeProcess;
      activeProcess = null;

      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /F /T /PID ${proc.pid}`);
        } else {
          proc.kill('SIGKILL');
        }
      } catch (e) {
        // すでに終了している場合のエラーは無視
      }
    }

    currentChannelKey = null;

    // 3. EDCB チューナーの開放
    console.log('[stopStream] Calling closeChannel()...');
    await closeChannel();

    // 4. HLS キャッシュのクリア
    cleanHlsDir();
    console.log('[stopStream] Stream and tuner stopped successfully.');

  } catch (err) {
    console.error('[stopStream Error]', err.message);
  } finally {
    isStopping = false;
  }
}

module.exports = { startStream, stopStream, updateHeartbeat };