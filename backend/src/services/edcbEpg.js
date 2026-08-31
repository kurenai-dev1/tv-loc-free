const net = require('net');
const { parseHostAndPort, dateToFileTime } = require('../utils/edcbUtils');
const { parsePgInfoExResponse } = require('./edcbEpgResponse');

const CMD2_EPG_SRV_ENUM_PG_INFO_EX = 1029;

/**
 * EDCB へ番組情報を取得をリクエストを送信する。
 *    時刻は文字列で渡す。(内部ではDateに変換)
 */
function getEpgData({ channel, startDate, endDate } = {}) {
  return new Promise((resolve, reject) => {
    const { host, port } = parseHostAndPort();

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(start.getTime() + 24 * 60 * 60 * 1000);

    // console.log(`${start.toISOString()}～${end.toISOString()}`);

    const client = net.connect({ port, host }, () => {
      const packet = Buffer.alloc(48);

      packet.writeUInt32LE(CMD2_EPG_SRV_ENUM_PG_INFO_EX, 0);
      packet.writeUInt32LE(40, 4);
      packet.writeUInt32LE(40, 8);
      packet.writeUInt32LE(4, 12);

      if (channel) {
        const parts = channel.split('-').map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
          packet.writeBigUInt64LE(0n, 16);
          const [onid, tsid, sid] = parts;
          const serviceIdBuf = Buffer.alloc(8);
          serviceIdBuf.writeUInt16LE(sid, 0);
          serviceIdBuf.writeUInt16LE(tsid, 2);
          serviceIdBuf.writeUInt16LE(onid, 4);
          packet.writeBigUInt64LE(serviceIdBuf.readBigUInt64LE(0), 24);
        } else {
          packet.writeBigUInt64LE(0x0000FFFFFFFFFFFFn, 16);
          packet.writeBigUInt64LE(0x0000FFFFFFFFFFFFn, 24);
        }
      } else {
        packet.writeBigUInt64LE(0x0000FFFFFFFFFFFFn, 16);
        packet.writeBigUInt64LE(0x0000FFFFFFFFFFFFn, 24);
      }

      packet.writeBigUInt64LE(dateToFileTime(start), 32);
      packet.writeBigUInt64LE(dateToFileTime(end), 40);

      client.write(packet);
    });

    let responseBuffer = Buffer.alloc(0);

    client.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);
    });

    client.on('end', () => {
      try {
        if (responseBuffer.length < 8) return reject(new Error('レスポンスヘッダー不足'));

        const resCode = responseBuffer.readUInt32LE(0);
        const dataSize = responseBuffer.readUInt32LE(4);

        let parsedData = null; 
         // if (resCode !== 1) return reject(new Error(`EDCB Command Error Code: ${resCode} ${channel}`));
        if (resCode !== 1) {
          console.log(`EDCB Command Error Code: ${resCode} ${channel}`);
        } else {
          const body = responseBuffer.subarray(8, 8 + dataSize);
          parsedData = parsePgInfoExResponse(body);
        }
        resolve(parsedData);
      } catch (err) {
        reject(err);
      }
    });

    client.on('error', (err) => reject(err));
  });
}

module.exports = { getEpgData };