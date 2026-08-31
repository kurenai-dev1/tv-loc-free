const fs = require('fs');
const { openChannel, closeChannel } = require('./edcbControl');

let currentChannelKey = null;
let heartbeatTimer = null;
let lastHeartbeatTime = Date.now();
let onTimeoutCallback = null;

/**
 * 名前付きパイプ SendTSTCP_* を検索
 */
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
 * EDCBのチューナーを開いてパイプパスを取得
 */
async function startEdcbTuner(onid, tsid, sid) {
  const channelKey = `${onid}-${tsid}-${sid}`;
  console.log(`[EDCB] Opening channel: ONID=${onid}, TSID=${tsid}, SID=${sid}`);
  
  await openChannel(onid, tsid, sid);
  currentChannelKey = channelKey;

  const pipePath = await findSendTsPipe(5000);
  // パイプ接続安定のためわずかに待機
  await new Promise(resolve => setTimeout(resolve, 500));

  return pipePath;
}

/**
 * EDCBのチューナーを解放
 */
async function stopEdcbTuner() {
  console.log('[EDCB] Releasing tuner...');
  stopHeartbeatMonitor();
  currentChannelKey = null;
  await closeChannel();
}

/**
 * Web UI用 ハートビート更新
 */
function updateHeartbeat() {
  lastHeartbeatTime = Date.now();
}

/**
 * Web UI用 ハートビート監視タイマー開始
 */
function startHeartbeatMonitor(onTimeout) {
  stopHeartbeatMonitor();
  lastHeartbeatTime = Date.now();
  onTimeoutCallback = onTimeout;

  heartbeatTimer = setInterval(async () => {
    if (Date.now() - lastHeartbeatTime > 15000) {
      console.log('[Heartbeat] Timeout detected. Stopping stream...');
      stopHeartbeatMonitor();
      if (onTimeoutCallback) await onTimeoutCallback();
    }
  }, 5000);
}

function stopHeartbeatMonitor() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function getCurrentChannelKey() {
  return currentChannelKey;
}

module.exports = {
  findSendTsPipe,
  startEdcbTuner,
  stopEdcbTuner,
  updateHeartbeat,
  startHeartbeatMonitor,
  stopHeartbeatMonitor,
  getCurrentChannelKey,
};