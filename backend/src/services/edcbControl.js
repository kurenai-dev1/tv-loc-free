const net = require('net');
const config = require('../config/env');

const CMD2_EPG_SRV_NWPLAY_OPEN = 0x00000431;
const CMD2_EPG_SRV_NWPLAY_CLOSE = 0x00000432;

const DEFAULT_CTRL_ID = 501;
let activeCtrlId = null;

function parseHostAndPort() {
  let rawHost = config.EDCB_HOST || '127.0.0.1';
  let host = rawHost.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  const port = Number(config.EDCB_PORT) || 4510;
  return { host, port };
}

/**
 * EDCB に NWTV 開始コマンドを送信
 */
function openChannel(onid, tsid, sid, ctrlId = DEFAULT_CTRL_ID) {
  return new Promise((resolve, reject) => {
    const { host, port } = parseHostAndPort();
    activeCtrlId = Number(ctrlId);

    console.log(`[EDCB Control] Opening channel with ctrl_id: ${activeCtrlId} (${host}:${port})`);

    const client = net.connect({ port, host }, () => {
      // 26 バイトのペイロード構築
      const payload = Buffer.alloc(26);
      payload.writeUInt32LE(26, 0);           // dwSize (26)
      payload.writeUInt32LE(1, 4);            // dwFlags (1)
      payload.writeUInt16LE(onid, 8);         // ONID
      payload.writeUInt16LE(tsid, 10);        // TSID
      payload.writeUInt16LE(sid, 12);         // SID
      payload.writeUInt16LE(1, 14);           // extra1 (1)
      payload.writeUInt16LE(activeCtrlId, 18); // extra2 (ctrl_id)
      payload.writeUInt16LE(2, 22);           // extra3 (2)

      // 8 バイトのヘッダー構築
      const header = Buffer.alloc(8);
      header.writeUInt32LE(CMD2_EPG_SRV_NWPLAY_OPEN, 0);
      header.writeUInt32LE(payload.length, 4); // 26

      // ★ openPacket を作成して送信
      const openPacket = Buffer.concat([header, payload]);
      client.write(openPacket);
    });

    // EDCB からの応答(8バイト以上)を受け取ってから切断・完了とする
    client.on('data', (data) => {
      if (data.length >= 8) {
        const resCode = data.readUInt32LE(0);
        console.log(`[EDCB Control] Open Response Code: ${resCode}`);
        client.end();
        resolve();
      }
    });

    client.on('error', (err) => {
      console.error('[EDCB Control Error on Open]', err.message);
      activeCtrlId = null;
      reject(err);
    });
  });
}

/**
 * EDCB に NWTV 終了コマンドを送信
 */
function closeChannel(ctrlId = null) {
  return new Promise((resolve) => {
    const targetId = ctrlId !== null ? Number(ctrlId) : (activeCtrlId || DEFAULT_CTRL_ID);
    activeCtrlId = null;

    const { host, port } = parseHostAndPort();

    const client = net.connect({ port, host }, () => {
      const packet = Buffer.alloc(12);
      packet.writeUInt32LE(CMD2_EPG_SRV_NWPLAY_CLOSE, 0); // 0x00000432
      packet.writeUInt32LE(4, 4);                          // データサイズ: 4
      packet.writeUInt32LE(targetId, 8);                   // target_id

      client.write(packet);
    });

    client.on('data', (data) => {
      if (data.length >= 8) {
        const resCode = data.readUInt32LE(0);
        console.log(`[EDCB Control] Close Response Code: ${resCode}`);
        client.end();
        resolve();
      }
    });

    client.on('error', (err) => {
      console.error('[EDCB Control Error on Close]', err.message);
      client.destroy();
      resolve();
    });
  });
}

module.exports = { openChannel, closeChannel };