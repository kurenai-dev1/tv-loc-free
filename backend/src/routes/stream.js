const express = require('express');
const router = express.Router();
const { startStream, stopStream, updateHeartbeat } = require('../services/ffmpeg');

// ハートビート受信用 API
router.post('/stream/heartbeat', (req, res) => {
  updateHeartbeat();
  res.json({ status: 'ok' });
})

/**
 * 配信開始 API
 * GET /api/stream?onid=xxx&tsid=xxx&sid=xxx
 */
router.get('/stream', (req, res) => {
  const { onid, tsid, sid } = req.query;

  if (!onid || !tsid || !sid) {
    return res.status(400).json({ error: 'Missing onid, tsid, or sid' });
  }

  startStream(onid, tsid, sid, (err, playlist) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to start stream', details: err.message });
    }
    res.json({ playlist });
  });
});

/**
 * 配信停止 & チューナー解放 API
 * POST /api/stream/stop
 */
router.post('/stream/stop', async (req, res) => {
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