const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
const { 
  startEdcbTuner, 
  stopEdcbTuner, 
  startHeartbeatMonitor, 
  getCurrentChannelKey 
} = require('./edcbStream');

let activeProcess = null;
let isStarting = false;
let isStopping = false;

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

function buildDynamicFFmpegArgs(mode, targetQuality) {
  const isQsv = config.FFMPEG_ENCODER === 'qsv';

  const qualities = (mode === 'single') 
    ? [targetQuality || config.ACTIVE_QUALITIES[0]] 
    : config.ACTIVE_QUALITIES;

  const streamMapParts = [];
  const encodeArgs = [];

  qualities.forEach((qKey, index) => {
    const profile = config.QUALITY_PROFILES[qKey];
    if (!profile) return;

    encodeArgs.push('-map', '0:v:0', '-map', '0:a:0');

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

    encodeArgs.push(
      `-c:a:${index}`, 'aac',
      `-b:a:${index}`, '128k'
    );

    streamMapParts.push(`v:${index},a:${index}`);
  });

  return {
    encodeArgs,
    varStreamMap: streamMapParts.join(' '),
  };
}

async function waitForFile(filePath, timeoutMs = 15000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) return true;
      }
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error(`Timeout waiting for file generation: ${filePath}`);
}

async function startStream(onid, tsid, sid, quality, callback) {
  const channelKey = `${onid}-${tsid}-${sid}`;
  const currentKey = getCurrentChannelKey();

  if (activeProcess && currentKey === channelKey) {
    console.log('[ffmpeg] Stream already running for this channel.');
    return callback(null, '/hls/master.m3u8');
  }

  if (isStarting) {
    console.log('[ffmpeg] Stream is currently starting, skipping duplicate request...');
    return callback(null, '/hls/master.m3u8');
  }

  isStarting = true;

  try {
    const isChannelChange = activeProcess !== null && currentKey !== channelKey;

    if (isChannelChange) {
      console.log(`[ffmpeg] Channel change detected: ${currentKey} -> ${channelKey}`);
      if (activeProcess) {
        const proc = activeProcess;
        activeProcess = null;
        try {
          if (process.platform === 'win32') {
            execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
          } else {
            proc.kill('SIGKILL');
          }
        } catch (e) {}
      }
    } else if (!activeProcess) {
      cleanHlsDir();
    }

    // EDCBのチューナーを起動し、パイプパスを取得
    const pipePath = await startEdcbTuner(onid, tsid, sid);

    const mode = config.STREAM_MODE || 'single';
    const dynamicConfig = buildDynamicFFmpegArgs(mode, quality);

    const ffmpegArgs = [
      '-y',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-i', pipePath,
      ...dynamicConfig.encodeArgs,
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

    // Web UI用のハートビートタイマーを開始
    startHeartbeatMonitor(stopStream);

    // 1. FFmpeg の stderr ログ出力
    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('corrupt') || msg.includes('timeout')) {
        console.error(`[FFmpeg stderr] ${msg.trim()}`);
      }
    });

    // 2. FFmpeg 終了時のクリーンアップ（★重複を削除して集約）
    ffmpeg.on('close', async (code, signal) => {
      console.log(`[ffmpeg] Process exited with code: ${code}, signal: ${signal}`);
      activeProcess = null;

      // 停止処理中（stopStream呼び出し済み）でない不意の終了の場合、追随して停止処理を実行
      if (!isStopping) {
        console.log('[ffmpeg] Unexpected termination detected. Cleaning up EDCB & HLS...');
        await stopStream();
      }
    });

    const masterPath = path.join(config.HLS_DIR, 'master.m3u8');
    await waitForFile(masterPath, 15000);

    callback(null, '/hls/master.m3u8');

  } catch (err) {
    console.error('Failed to start stream:', err.message);
    await stopStream();
    callback(err);
  } finally {
    isStarting = false;
  }
}

function getActiveProcess() {
  return activeProcess;
}

async function stopStream() {
  if (isStopping) return;
  isStopping = true;

  try {
    console.log('[stopStream] Stopping stream...');

    if (activeProcess) {
      console.log(`[ffmpeg] Killing active process PID: ${activeProcess.pid}`);
      const proc = activeProcess;
      activeProcess = null;

      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' });
        } else {
          proc.kill('SIGKILL');
        }
      } catch (e) {}
    }

  } catch (err) {
    console.error('[stopStream FFmpeg Kill Error]', err.message);
  }

  // ★ FFmpeg殺傷の成功成否にかかわらず、確実にチューナー解放へ進む
  try {
    await stopEdcbTuner();
    cleanHlsDir();
  } catch (err) {
    console.error('[stopStream EDCB Stop Error]', err.message);
  } finally {
    isStopping = false;
  }
}

module.exports = { startStream, stopStream, getActiveProcess };