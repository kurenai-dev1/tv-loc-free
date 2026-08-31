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

/**
 * EDCBバイナリデータの解読ヘルパー（文字列および可変長配列のデコード）
 */
function readEpgData(buf) {
  let offset = 0;

  // wstring (2byteの文字数 + UTF-16LEデータ) の読み込み
  const readWString = () => {
    if (offset + 2 > buf.length) return '';
    const charCount = buf.readUInt16LE(offset);
    offset += 2;
    if (charCount === 0) return '';
    
    const byteLen = charCount * 2;
    if (offset + byteLen > buf.length) return '';
    
    const str = buf.toString('utf16le', offset, offset + byteLen);
    offset += byteLen;
    return str;
  };

  // SYSTEMTIME (16bytes) の読み込み -> Date オブジェクトへ変換
  const readSystemTime = () => {
    if (offset + 16 > buf.length) {
      offset += 16;
      return null;
    }
    const year = buf.readUInt16LE(offset);
    const month = buf.readUInt16LE(offset + 2) - 1;
    // offset + 4: wDayOfWeek (skip)
    const day = buf.readUInt16LE(offset + 6);
    const hour = buf.readUInt16LE(offset + 8);
    const minute = buf.readUInt16LE(offset + 10);
    const second = buf.readUInt16LE(offset + 12);
    offset += 16;

    if (year === 0) return null; // 未定の場合
    // UTCで生成した後にJST補正
    return new Date(Date.UTC(year, month, day, hour - 9, minute, second));
  };

  if (buf.length < 4) return [];

  const serviceCount = buf.readUInt32LE(offset);
  offset += 4;
  const services = [];

  for (let i = 0; i < serviceCount; i++) {
    if (offset >= buf.length) break;

    const onid = buf.readUInt16LE(offset);
    const tsid = buf.readUInt16LE(offset + 2);
    const sid = buf.readUInt16LE(offset + 4);
    offset += 6;

    const serviceName = readWString();
    const serviceProvider = readWString();
    const networkName = readWString();

    // 不要な文字列フィールド（ts_name, remote_control_key_id）をスキップ
    readWString(); 
    readWString();

    const eventCount = buf.readUInt32LE(offset);
    offset += 4;
    const events = [];

    for (let j = 0; j < eventCount; j++) {
      if (offset >= buf.length) break;

      const eventId = buf.readUInt16LE(offset);
      offset += 2;

      // startTimeFlag (1byte), durationFlag (1byte) 等のフラグ類チェック
      const hasStartTime = buf.readUInt8(offset) !== 0;
      offset += 1;
      const startTime = readSystemTime();

      const hasDuration = buf.readUInt8(offset) !== 0;
      offset += 1;
      const durationSec = buf.readUInt32LE(offset);
      offset += 4;

      // short_info (番組タイトル・説明) の存在チェック
      const hasShortInfo = buf.readUInt8(offset) !== 0;
      offset += 1;

      let title = '';
      let text = '';
      if (hasShortInfo) {
        title = readWString();
        text = readWString();
      }

      // ext_info, content_info などの可変長データを適切にスキップ
      const hasExtInfo = buf.readUInt8(offset) !== 0;
      offset += 1;
      if (hasExtInfo) {
        readWString(); // detail
      }

      const hasContentInfo = buf.readUInt8(offset) !== 0;
      offset += 1;
      if (hasContentInfo) {
        const nibbleCount = buf.readUInt16LE(offset);
        offset += 2 + (nibbleCount * 2); // nibble_list
      }

      const hasComponentInfo = buf.readUInt8(offset) !== 0;
      offset += 1;
      if (hasComponentInfo) {
        offset += 2; // component_tag, component_type
        readWString(); // text
      }

      const hasAudioInfo = buf.readUInt8(offset) !== 0;
      offset += 1;
      if (hasAudioInfo) {
        const audioCount = buf.readUInt16LE(offset);
        offset += 2;
        for (let k = 0; k < audioCount; k++) {
          offset += 8; // 各種フラグ・言語コード等
          readWString();
        }
      }

      // その他の固定長フィールド・フラグ類のスキップ
      offset += 1 + 1 + 2; // free_CA_mode, event_group_info, event_relay_info のフラグ等

      const endTime = (startTime && durationSec) 
        ? new Date(startTime.getTime() + durationSec * 1000) 
        : null;

      events.push({
        eventId,
        title,
        text,
        startTime,
        endTime,
        durationSec
      });
    }

    services.push({
      onid,
      tsid,
      sid,
      serviceName,
      events
    });
  }

  return services;
}

module.exports = { openChannel, closeChannel };
