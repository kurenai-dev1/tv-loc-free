const { getEpgData } = require('./edcbEpg');
const { jellyfinChannels } = require('../config/env'); // 環境設定からチャンネル定義を読み込み

// XML特殊文字のエスケープ
function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Date オブジェクトを XMLTV 日付表記 (YYYYMMDDhhmmss +0900) に変換
function formatXmltvDate(date) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';

  // UTC時刻に9時間を加算してJSTの表記を生成
  const jstDate = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');

  const year = jstDate.getUTCFullYear();
  const month = pad(jstDate.getUTCMonth() + 1);
  const day = pad(jstDate.getUTCDate());
  const hours = pad(jstDate.getUTCHours());
  const minutes = pad(jstDate.getUTCMinutes());
  const seconds = pad(jstDate.getUTCSeconds());

  return `${year}${month}${day}${hours}${minutes}${seconds} +0900`;
}

/**
 * XMLTV 文字列生成メイン関数
 * 現時刻から 1 日先（24時間）までの全設定チャンネルの EPG データを取得して出力する
 * ※ 一週間分が普通だが、録画機能が無いので無意味
 */
async function generateXmltv() {
  const now = new Date();
  const startDate = new Date(now.getTime() -  2 * 60 * 60 * 1000); //  2時間前
  const endDate   = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24時間後

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
  xml += '<tv generator-info-name="EDCB-Jellyfin-Interface">\n';

  // 1. チャンネル要素 (<channel>) の出力
  for (const ch of jellyfinChannels) {
    // XMLTV 内でのチャンネル識別子 ("onid-tsid-sid" または "sid")
    const chId = ch.id;
    const chName = ch.name || chId;

    xml += `  <channel id="${escapeXml(chId)}">\n`;
    xml += `    <display-name lang="ja">${escapeXml(chName)}</display-name>\n`;
    xml += `  </channel>\n`;
  }

  // 2. 各チャンネルの EPG データ取得と番組要素 (<programme>) の出力
  for (const ch of jellyfinChannels) {
    const chKey = ch.id;

    // １チャンネルの番組表オブジェクトの取得
    try {
      const epgData = await getEpgData({
        channel: chKey,
        startDate,
        endDate
      });

      if (!epgData) continue;
      const epgList = Array.isArray(epgData.programs) ? epgData.programs : [];

      for (const item of epgList) {
        // 開始時間と終了時間の確定
        const startTime = new Date(item.start);
        if (!startTime) continue;
        const endTime = new Date(startTime.getTime()+item.duration_sec*1000);
        if (!endTime) continue;

        const startStr = formatXmltvDate(startTime);
        const stopStr = formatXmltvDate(endTime);
        const title = item.title || '番組情報なし';
        const detail = item.detail || '';

        xml += `  <programme start="${startStr}" stop="${stopStr}" channel="${escapeXml(chKey)}">\n`;
        xml += `    <title lang="ja">${escapeXml(title)}</title>\n`;
        if (detail) {
          xml += `    <desc lang="ja">${escapeXml(detail)}</desc>\n`;
        }
        xml += `  </programme>\n`;
      }
    } catch (err) {
      console.error(`[XMLTV] Failed to fetch EPG for channel ${chKey}:`, err);
    }
  }

  xml += '</tv>';
  return xml;
}

module.exports = { generateXmltv };