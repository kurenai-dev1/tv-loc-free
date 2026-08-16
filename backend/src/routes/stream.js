const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// サービス層から関数を読み込み
const { startStream, stopStream, updateHeartbeat } = require('../services/ffmpeg');

// HLS出力先の絶対パス（環境に合わせて調整してください）
const HLS_DIR_PATH = path.join(__dirname, '../../public/hls');

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
  updateHeartbeat();
  res.json({ status: 'ok' });
});

/**
 * 配信開始 API (POST /api/stream/start)
 */
router.post('/start', async (req, res) => {
  const { onid, tsid, sid } = req.body;

  if (onid === undefined || tsid === undefined || sid === undefined) {
    return res.status(400).json({ error: 'Missing onid, tsid, or sid' });
  }

  const numOnid = parseInt(onid, 10);
  const numTsid = parseInt(tsid, 10);
  const numSid = parseInt(sid, 10);

  console.log(`[API /stream] Starting stream for ONID:${numOnid}, TSID:${numTsid}, SID:${numSid}`);

  try {
    // 1. 古い FFmpeg プロセスの終了 ＆ HLS ディレクトリのクリア
    await stopStream();
    cleanHlsDirectory(HLS_DIR_PATH);

    // 2. FFmpeg 起動（非同期で呼び出し）
    // 注意: startStream がコールバック形式の場合は Promise 化して呼び出します
    await new Promise((resolve, reject) => {
      startStream(numOnid, numTsid, numSid, (err, playlist) => {
        if (err) reject(err);
        else resolve(playlist);
      });
    });

    // 3. 最初の .ts ファイルができるまで最大 10秒 待機
    const isReady = await waitForFirstSegment(HLS_DIR_PATH, 10000);

    if (!isReady) {
      console.error('[Stream Error] Timeout: TS segment was not generated in time.');
      await stopStream();
      return res.status(504).json({ error: 'Stream generation timed out.' });
    }

    // 4. 準備完了後にレスポンスを返す
    return res.json({ success: true, playlist: '/hls/master.m3u8', url: '/hls/master.m3u8' });

  } catch (err) {
    console.error('[API /stream Error]', err);
    await stopStream();
    return res.status(500).json({ error: 'Failed to start stream', details: err.message });
  }
});

/**
 * 配信停止 & チューナー解放 API (POST /api/stream/stop)
 */
router.post('/stop', async (req, res) => {
  try {
    console.log('[API] Stop stream requested');
    await stopStream();
    res.json({ success: true, message: 'Stream stopped successfully' });
  } catch (err) {
    console.error('[API Error] Failed to stop stream:', err);
    res.status(500).json({ error: 'Failed to stop stream', details: err.message });
  }
});

module.exports = router;