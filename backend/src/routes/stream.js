const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { jellyfinChannels } = require('../config/env');
const { startEdcbTuner, stopEdcbTuner } = require('../services/edcbStream');
const { getActiveProcess } = require('../services/ffmpeg');

// サービス層から関数を読み込み
const { startStream, stopStream } = require('../services/ffmpeg');
const { updateHeartbeat } = require('../services/edcbStream');

// HLS出力先の絶対パス（環境に合わせて調整してください）
const HLS_DIR_PATH = path.join(__dirname, '../../public/hls');

// ★ 現在配信（FFmpeg）を所有しているホストの clientId を保持する変数
let currentHostClientId = null;

/**
 * 最初の .ts セグメント（サイズ > 0）の生成を待つ関数
 */
async function waitForFirstSegment(dirPath, timeoutMs = 10000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (fs.existsSync(dirPath)) {
      try {
        const files = fs.readdirSync(dirPath);
        // .ts ファイルが存在し、書き込みが開始（> 0 Byte）されているかチェック
        const tsFile = files.find(file => file.endsWith('.ts'));
        if (tsFile) {
          const filePath = path.join(dirPath, tsFile);
          const stats = fs.statSync(filePath);
          if (stats.size > 0) {
            console.log(`[Stream] Ready! Found ${tsFile} (${stats.size} bytes) in ${Date.now() - startTime}ms`);
            return true;
          }
        }
      } catch (e) {
        // ファイル書き込みアクセス競合時のガード
      }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  return false;
}

/**
 * HLSディレクトリ内の古いファイルをクリアする関数
 */
function cleanHlsDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    try {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
          fs.unlinkSync(path.join(dirPath, file));
        }
      }
    } catch (err) {
      console.error('[HLS Clean Error]', err);
    }
  } else {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ハートビート受信用 API (POST /api/stream/heartbeat)
router.post('/heartbeat', (req, res) => {
  const { clientId } = req.body;

  // FFmpeg プロセスが存在し、終了していなければ true
  const activeProcess = getActiveProcess();
  const isStreaming = activeProcess !== null && !activeProcess.killed;

  // ★ 配信中かつ「ホスト」からのハートビートの場合のみ EDCB 側のタイマーを更新
  if (isStreaming && currentHostClientId && currentHostClientId === clientId) {
    updateHeartbeat();
  } else if (!isStreaming) {
    // FFmpeg が落ちている場合はホストもクリア
    currentHostClientId = null;
  }

  res.json({ status: 'ok', isStreaming: isStreaming });
});

/**
 * 配信開始 API (POST /api/stream/start)
 */
router.post('/start', async (req, res) => {
  const { onid, tsid, sid, quality, clientId } = req.body;

  if (onid === undefined || tsid === undefined || sid === undefined) {
    return res.status(400).json({ error: 'Missing onid, tsid, or sid' });
  }

  const numOnid = parseInt(onid, 10);
  const numTsid = parseInt(tsid, 10);
  const numSid = parseInt(sid, 10);

  // ★ 現在 FFmpeg が動いているか確認
  const activeProcess = getActiveProcess();
  const isStreamingActive = activeProcess !== null && !activeProcess.killed;

  // ★【ケース1】既に配信中で、かつリクエスト元が現在のホストではない場合（ビジター処理）
  if (isStreamingActive && currentHostClientId !== null && currentHostClientId !== clientId) {
    console.log(`[API /stream] Visitor connected (ClientID: ${clientId}). Reusing current stream.`);
    return res.json({
      success: true,
      playlist: '/hls/master.m3u8',
      url: '/hls/master.m3u8',
      isVisitor: true, // フロントエンドにビジターであることを通知
    });
  }

  // ★【ケース2】新規配信開始、またはホスト自身によるチャンネル変更・再リクエスト処理
  console.log(`[API /stream] Starting/Updating stream for Host (ClientID: ${clientId}), ONID:${numOnid}, TSID:${numTsid}, SID:${numSid}, Quality:${quality || 'default'}`);

  try {
    // 1. 古い FFmpeg プロセスの終了 ＆ HLS ディレクトリのクリア
    await stopStream();
    cleanHlsDirectory(HLS_DIR_PATH);

    // 2. FFmpeg 起動
    await new Promise((resolve, reject) => {
      startStream(numOnid, numTsid, numSid, quality, (err, playlist) => {
        if (err) reject(err);
        else resolve(playlist);
      });
    });

    // 3. 最初の .ts ファイルができるまで最大 10秒 待機
    const isReady = await waitForFirstSegment(HLS_DIR_PATH, 10000);

    if (!isReady) {
      console.error('[Stream Error] Timeout: TS segment was not generated in time.');
      await stopStream();
      currentHostClientId = null;
      return res.status(504).json({ error: 'Stream generation timed out.' });
    }

    // ★ ホストIDを現在の clientId に更新・保持
    currentHostClientId = clientId;
    updateHeartbeat();

    // 4. 準備完了後にレスポンスを返す
    return res.json({
      success: true,
      playlist: '/hls/master.m3u8',
      url: '/hls/master.m3u8',
      isVisitor: false,
    });

  } catch (err) {
    console.error('[API /stream Error]', err);
    await stopStream();
    currentHostClientId = null;
    return res.status(500).json({ error: 'Failed to start stream', details: err.message });
  }
});

/**
 * 配信停止 & チューナー解放 API (POST /api/stream/stop)
 */
router.post('/stop', async (req, res) => {
  const { clientId } = req.body;

  try {
    console.log(`[API] Stop stream requested from ClientID: ${clientId}`);

    const activeProcess = getActiveProcess();
    const isStreamingActive = activeProcess !== null && !activeProcess.killed;

    // ★ 配信中かつ、リクエスト元がホストではない（ビジター）場合は、FFmpegを殺さず離脱だけ許可する
    if (isStreamingActive && currentHostClientId !== null && currentHostClientId !== clientId) {
      console.log(`[API] Visitor (ClientID: ${clientId}) left. Keeping stream alive for host.`);
      return res.json({ success: true, message: 'Visitor disconnected successfully' });
    }

    // ★ ホストからの停止要求、または既に配信が停まっている場合は FFmpeg・EDCB を停止
    await stopStream();
    currentHostClientId = null;
    res.json({ success: true, message: 'Stream stopped successfully' });
  } catch (err) {
    console.error('[API Error] Failed to stop stream:', err);
    res.status(500).json({ error: 'Failed to stop stream', details: err.message });
  }
});

// GET /api/stream/config
router.get('/config', (req, res) => {
  const mode = process.env.STREAM_MODE || 'multi';
  const qualities = process.env.STREAM_QUALITIES 
    ? process.env.STREAM_QUALITIES.split(',') 
    : ['720p', '480p', '360p'];

  res.json({
    mode,
    qualities,
    defaultQuality: qualities[0] || '720p',
  });
});

/**
 * Jellyfin 用 Direct TS データ配信 API
 * GET /api/stream/live/:channelId
 */
router.get('/live/:channelId', async (req, res) => {
  const { channelId } = req.params;
  const targetCh = jellyfinChannels.find(ch => ch.id === channelId);

  if (!targetCh) return res.status(404).send('Channel not found');

  const [onid, tsid, sid] = channelId.split('-').map(v => parseInt(v, 10));
  console.log(`[Jellyfin Direct TS] 視聴開始: ${targetCh.name} (${channelId})`);

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');

  let readStream = null;

  try {
    const pipePath = await startEdcbTuner(onid, tsid, sid);

    readStream = fs.createReadStream(pipePath);

    readStream.on('error', (err) => {
      if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
        console.log(`[Jellyfin Direct TS] パイプ切断を検知 (${err.code}): 正常終了処理を行います`);
      } else {
        console.error('[Jellyfin Direct TS Stream Error]', err.message);
      }
      if (readStream) {
        readStream.destroy();
      }
    });

    readStream.pipe(res);

    req.on('close', async () => {
      console.log(`[Jellyfin Direct TS] 切断検出: ${targetCh.name}`);
      if (readStream) {
        readStream.destroy();
      }
      await stopEdcbTuner();
    });

  } catch (err) {
    console.error('[Jellyfin Direct TS Error]', err);
    if (!res.headersSent) res.status(500).send('Streaming error');
    if (readStream) readStream.destroy();
    await stopEdcbTuner();
  }
});

module.exports = router;