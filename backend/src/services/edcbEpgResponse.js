const net = require('net');
const { parseHostAndPort, dateToFileTime } = require('../utils/edcbUtils');

// 2バイト文字数ヘッダー付き UTF-16LE / UCS-2LE 文字列読み出し
function readWString(buf, start, byteLen ) {
  // console.log(`String Len ${byteLen}`);  
  const str = buf.toString('utf16le', start, start+byteLen);
  return str;
}

// SYSTEMTIME (16バイト) 解析
function parseSystemTime(buf, offset) {
  if (offset + 16 > buf.length) return null;
  const year = buf.readUInt16LE(offset);
  const month = buf.readUInt16LE(offset + 2);
  const day = buf.readUInt16LE(offset + 6);
  const hour = buf.readUInt16LE(offset + 8);
  const minute = buf.readUInt16LE(offset + 10);
  const second = buf.readUInt16LE(offset + 12);

  if (year >= 2020 && year <= 2035) {
    return new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second));
  }
  return null;
}
// 0x0000 終端までを読み取り、UTF-8 (JavaScript String) に変換して返す
function readNullTerminatedWString(buf, offset) {
  let start = offset;
  let end = start;

  // 2バイト境界で 0x0000 (NUL文字) を検索
  while (end + 1 < buf.length) {
    if (buf.readUInt16LE(end) === 0) {
      break;
    }
    end += 2;
  }

  if (end >= buf.length) return '';

  // UCS-2LE (UTF-16LE) バッファを JavaScript 標準文字列 (UTF-8) へ変換
  const str = buf.toString('utf16le', start, end);
  
  // 読み進めた位置を 0x0000 の直後 (2バイト先) へ更新
  offset = end + 2; 
  return str;
}

// ヘッダーブロックの解析
function parseHeaderBlock(buf, offset) {
  let result = {};

  // チャンネル基本情報（ONID, TSID, SID）
  const onid = buf.readUInt16LE(offset);
  const tsid = buf.readUInt16LE(offset + 2);
  const sid  = buf.readUInt16LE(offset + 4);
  const channelId = `${onid}-${tsid}-${sid}`;
  // console.log(`channelId ${channelId}`);  
  offset += 6; 
  offset += 2; // 01 00 (unknown)

  // 地デジでは空文字が多い BSは正式名
  let strSize = buf.readUInt32LE(offset)-4; // -4 自身の長さ
  offset += 4;
  const preName = readWString(buf, offset, strSize-2); // -2="00 00"
  // console.log(`preName ${preName}`);  
  offset += strSize;

  // 局名(通称)
  strSize = buf.readUInt32LE(offset)-4; // -4 自身の長さ
  offset +=4;
  const serviceName = readWString(buf, offset, strSize-2);
  // console.log(`serviceName ${serviceName}`);  
  offset += strSize;

  // 地域
  strSize = buf.readUInt32LE(offset)-4; 
  offset +=4;
  const areaName = readWString(buf, offset, strSize-2);
  // console.log(`areaName ${areaName}`);  
  offset += strSize;

  // 補足 空文字が多い
  strSize = buf.readUInt32LE(offset)-4;
  offset +=4;
  const subName = readWString(buf, offset, strSize-2);
  // console.log(`subName ${subName}`);  
  offset += strSize;

  result = {
    channel_id: channelId,
    service_name: serviceName,
  };

  return result;
}

// 番組情報ブロックの解析
function parseProgramBlock(buf, offset) {
  let result = {};

  // チャンネル基本情報（ONID, TSID, SID）
  const onid = buf.readUInt16LE(offset);
  const tsid = buf.readUInt16LE(offset + 2);
  const sid  = buf.readUInt16LE(offset + 4);
  const channelId = `${onid}-${tsid}-${sid}`;
  // console.log(`channelId ${channelId}`);  
  offset += 6;

  const eventId = buf.readUInt16LE(offset);
  // console.log(`eventId ${eventId}`);  
  offset += 2;

  // 開始時刻
  const startTimeFlag = buf.readUInt8(offset);
  offset += 1;

  let startTime = null;
  if (startTimeFlag !== 0 ) {
    startTime = parseSystemTime(buf, offset);
    // console.log(`startTime ${startTime}`); 
    offset += 16;
  }
  // 放送時間
  const durationFlag = buf.readUInt8(offset);
  offset += 1;
  
  let durationSec = 0;
  if (durationFlag !== 0 ) {
    durationSec = buf.readUInt32LE(offset);
    // console.log(`durationSec ${durationSec}`); 
    offset += 4;
  }

  offset += 4; // ???

  let strSize = buf.readUInt32LE(offset)-4; // -4 自身の長さ
  offset +=4;

  const title = readWString(buf, offset, strSize-2);
  // console.log(`title ${title}`);  
  offset += strSize;

  strSize = buf.readUInt32LE(offset)-4;
  offset +=4;

  const detail = readWString(buf, offset, strSize-2);
  // console.log(`detaile ${detail}`);  
  offset += strSize;

  result = {
    id: `${channelId}_${eventId}`,
    channel_id: channelId,
    event_id: eventId,
    start: startTime ? startTime.toISOString() : null,
    duration_sec: durationSec,
    title: title,
    detail: detail,
  };

  return result;
}

/**
 * EDCB の番組情報レスポンスを解析してオブジェクトとして返す
 */
function parsePgInfoExResponse(buf) {
  let result = {};
  let offset = 0;

  if (buf.length < 46) return result; // 根拠なし

  offset = 0; // buf オブジェクトと対で使うポインタ

  // メインブロックの解析
  const dataSize = buf.readUInt32LE(offset);
  // console.log(`データサイズ ${dataSize}`);  
  offset += 4;

  const blockType = buf.readUInt32LE(offset);
  // console.log(`ブロックタイプ ${blockType}`);  
  offset += 4;

  const blockSize = buf.readUInt32LE(offset);
  // console.log(`ブロックサイズ ${blockSize}`);  
  offset += 4;

  const headerBlockSize = buf.readUInt32LE(offset);
  // console.log(`ヘッダーブロックサイズ ${headerBlockSize}`);  
  // offset += 4; 

  const headerObject = parseHeaderBlock(buf, offset+4);
  // result.header = headerObject;
 
  offset += headerBlockSize;
  if( offset > dataSize ) return result;

  const programBlockStart = offset;

  const allProgramBlockSize = buf.readUInt32LE(offset);
  offset += 4; 

  const programCount = buf.readUInt32LE(offset);
  // console.log(`全番組ブロックサイズ ${allProgramBlockSize} 番組数 ${programCount}`);  
  offset += 4; 

  // 番組情報
  let programs = [];
  while( offset < programBlockStart + allProgramBlockSize ) {
    // 番組数でチェックしても良いが未実装

    const programBlockSize = buf.readUInt32LE(offset);
    // console.log(`番組ブロックサイズ ${programBlockSize}`);  
    const programObject = parseProgramBlock( buf, offset+4 );
    programs.push(programObject);
    offset += programBlockSize; // 次の番組
  }

  result = {
    header: headerObject,
    programs: programs,
  };

  return result;
}

module.exports = { parsePgInfoExResponse };