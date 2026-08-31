const config = require('../config/env');

/**
 * 環境変数またはデフォルト値から EDCB の接続先ホストとポートをパースして取得
 * @returns {{ host: string, port: number }}
 */
function parseHostAndPort() {
  let rawHost = config.EDCB_HOST || '127.0.0.1';
  // http:// や URL 形式の入力からホスト名のみを抽出
  let host = rawHost.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
  const port = Number(config.EDCB_PORT) || 4510;
  return { host, port };
}

/**
 * JavaScript の Date オブジェクトを EDCB(Windows FILETIME / JST) へ変換
 * @param {Date} date 
 * @returns {bigint}
 * Date の値がGMTなのでJST時間の補正が必要。
 */
function dateToFileTime(date) {
  // 1601年〜1970年のミリ秒差
  const EPOCH_DIFF_MS = 11644473600000n;
  
  // ミリ秒を切り捨てて1秒単位（000ms）に丸める
  const timeMs = (BigInt(date.getTime()) / 1000n) * 1000n;

  // 2. JST (+9時間) 分のミリ秒を加算 (9 * 60 * 60 * 1000 = 32,400,000 ms)
  const JST_OFFSET_MS = 32400000n;
  const ms = BigInt(timeMs) + JST_OFFSET_MS;

  // 100ナノ秒単位に変換
  return (ms + EPOCH_DIFF_MS) * 10000n;
}

/**
 * Windows FILETIME (64bit BigInt) を JavaScript の Date オブジェクトへ変換
 * @param {bigint} fileTime 
 * @returns {Date}
 */
function fileTimeToDate(fileTime) {
  const EPOCH_DIFF_MS = 11644473600000n;
  const ms = (BigInt(fileTime) / 10000n) - EPOCH_DIFF_MS;
  return new Date(Number(ms));
}

module.exports = {
  parseHostAndPort,
  dateToFileTime,
  fileTimeToDate
};