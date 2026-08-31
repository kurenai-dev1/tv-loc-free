const express = require('express');
const router = express.Router();
const fs = require('fs');
const iconv = require('iconv-lite');
const { getChSetFilePath } = require('../utils/edcbPath');
const { getCurrentEpg } = require('../services/edcbControl');
const { jellyfinChannels } = require('../config/env');

/**
 * 局の並び順優先度（ソート用インデックス）を計算する関数
 */
function getSortOrder(ch) {
  const name = ch.name;

  if (ch.type === 'GR') {
    if (name.includes('ＮＨＫ総合') || name.includes('NHK総合')) return 1;
    if (name.includes('ＮＨＫＥテレ') || name.includes('NHKEテレ') || name.includes('Ｅテレ')) return 2;
    if (name.includes('日テレ') || name.includes('日本テレビ')) return 4;
    if (name.includes('朝日') || name.includes('テレビ朝日')) return 5;
    if (name.includes('ＴＢＳ') || name.includes('TBS')) return 6;
    if (name.includes('テレ東') || name.includes('テレビ東京')) return 7;
    if (name.includes('フジ')) return 8;
    if (name.includes('ＭＸ') || name.includes('MX')) return 9;
    if (name.includes('ｔｖｋ') || name.includes('tvk') || name.includes('テレビ神奈川')) return 10;
    if (name.includes('テレ玉')) return 11;
    if (name.includes('チバテレ')) return 12;
    return 99;
  }

  if (ch.type === 'BS') {
    if (name.includes('ＮＨＫ') || name.includes('NHK')) return 1;
    if (name.includes('日テレ')) return 2;
    if (name.includes('朝日')) return 3;
    if (name.includes('ＴＢＳ') || name.includes('TBS')) return 4;
    if (name.includes('テレ東')) return 5;
    if (name.includes('フジ')) return 6;
    if (name.includes('ＷＯＷＯＷ') || name.includes('WOWOW')) return 7;
    if (name.includes('１１') || name.includes('11')) return 8;
    if (name.includes('１２') || name.includes('12')) return 9;
    return 99;
  }

  return 999;
}

/**
 * GET /api/channel/channels
 * チャンネル一覧を取得（高速・静的情報）
 */
router.get('/channels', (req, res) => {
  try {
    const chSetPath = getChSetFilePath();
    if (!fs.existsSync(chSetPath)) {
      return res.status(404).json({ error: 'ChSet file not found', path: chSetPath });
    }

    const buffer = fs.readFileSync(chSetPath);
    let content = iconv.decode(buffer, 'cp932');

    if (!content.includes('\t')) {
      content = iconv.decode(buffer, 'utf-16le');
    }

    const lines = content.split(/\r?\n/);
    const rawChannels = [];

    lines.forEach((line) => {
      const cleanLine = line.replace(/^\uFEFF/, '').trim();
      if (!cleanLine) return;

      const cols = cleanLine.split('\t');

      if (cols.length >= 6) {
        const name = cols[0];
        const onid = parseInt(cols[2], 10);
        const tsid = parseInt(cols[3], 10);
        const sid = parseInt(cols[4], 10);
        const serviceType = parseInt(cols[5], 10);

        if (name && !isNaN(onid) && !isNaN(tsid) && !isNaN(sid) && serviceType === 1) {
          let type = 'GR';
          if (onid === 4) {
            type = 'BS';
          } else if (onid === 6 || onid === 7) {
            type = 'CS';
          } else {
            type = 'GR';
          }

          if (name.includes('ワンセグ') || name.includes('携帯') || name.includes('臨時') || name.includes('BS Digital') || name === '－') {
            return;
          }

          rawChannels.push({ name, onid, tsid, sid, type });
        }
      }
    });

    const channelMap = new Map();
    rawChannels.forEach((ch) => {
      const groupKey = ch.type === 'GR' 
        ? `GR_${ch.onid}_${ch.tsid}`
        : `${ch.type}_${ch.name}`;

      if (!channelMap.has(groupKey)) {
        channelMap.set(groupKey, ch);
      } else {
        const existing = channelMap.get(groupKey);
        if (ch.sid < existing.sid) {
          channelMap.set(groupKey, ch);
        }
      }
    });

    const uniqueChannels = Array.from(channelMap.values());

    uniqueChannels.sort((a, b) => {
      const orderA = getSortOrder(a);
      const orderB = getSortOrder(b);

      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.sid - b.sid;
    });

    res.json(uniqueChannels);

  } catch (err) {
    console.error('[Channels API] Error parsing file:', err);
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

/**
 * GET /api/epg/current
 * 現在放送中の番組表一覧を取得（EDCB動的取得）
 * レスポンスはフロントで照合しやすいように { "ONID_TSID_SID": programObject } のマップ形式で返します
 */
/*
router.get('/epg/current', async (req, res) => {
  try {
    const epgData = await getCurrentEpg();
    
    // フロントエンド側で `epgMap[`${ch.onid}_${ch.tsid}_${ch.sid}`]` で即座にひけるオブジェクト構造にする
    const epgMap = {};
    epgData.forEach((service) => {
      const key = `${service.onid}_${service.tsid}_${service.sid}`;
      epgMap[key] = service.currentProgram;
    });

    res.json(epgMap);
  } catch (err) {
    console.error('[EPG API] Error fetching current EPG:', err);
    res.status(500).json({ error: 'Failed to fetch EPG' });
  }
});
*/

/**
 * GET /api/channel/channels.m3u (Jellyfin用 M3U プレイリスト)
 */
router.get('/channels.m3u', (req, res) => {
  const host = req.headers.host;
  const protocol = req.protocol;

  let m3u = '#EXTM3U\n';
  
  for (const ch of jellyfinChannels) {
    // tvg-id / channel-id を XMLTV 側の channel id と完全一致させる
    m3u += `#EXTINF:-1 tvg-id="${ch.id}" channel-id="${ch.id}",${ch.name}\n`;
    m3u += `${protocol}://${host}/api/stream/live/${ch.id}\n`;
  }

  res.setHeader('Content-Type', 'text/plain; charset=UTF-8');
  res.send(m3u);

/*
  // ★ キャッシュ防止ヘッダーを設定
  res.setHeader('Content-Type', 'audio/x-mpegurl');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // ★ 200 OK で毎回レスポンス本体を確実に返す
  res.status(200).send(m3u);
*/

});

module.exports = router;