const express = require('express');
const router = express.Router();
const { getEpgData } = require('../services/edcbEpg');
const { generateXmltv } = require('../services/edcbEpgXml');

// 時刻文字列（"HH:MM"）のフォーマットヘルパー
function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// ONID-TSID-SID のチャンネルから指定された期間の番組情報Objectを取得する
async function getEpgObject( channel, startDate, endDate ) {
  try {
    const epgData = await getEpgData({channel, startDate, endDate});
    return epgData;
  } catch (err) {
    console.error('[EPG API] Error fetching EPG:', err);
    res.status(500).json({ error: 'Failed to fetch EPG data' });
  }
}

// GET /epg/current (現在放送中の番組情報を1件返却)
// 例: /epg/current?channel=32736-32736-1024
router.get('/current', async (req, res) => {
  try {
    const { channel, start, end } = req.query;

    // 時刻指定がなければ「1日前」から「現在時刻」までをデフォルト範囲に設定
    const now = new Date();
    const startDate = start || new Date(now.getTime() - 24 * 60 * 60 * 1000 ).toISOString();
    const endDate   = end   || now.toISOString();

    const epgData = await getEpgObject( channel, startDate, endDate );

    const programs = Array.isArray(epgData.programs) ? epgData.programs : [epgData.programs];
    if (!programs) {
      return res.json(null);
    }

    // 取得した番組の中から「現在時刻が放送期間に含まれる番組」を抽出
    const program = programs.find(prog => {
      const progStart = new Date(prog.start || prog.startTime);
      const progEnd = new Date(progStart.getTime()+prog.duration_sec*1000);
      return progStart <= now && now < progEnd;
    }) || programs[programs.length - 1] || null; // 該当がなければ最新の1件

    let progStart= startDate;
    let progEnd = endDate;
    if( program.start ) progStart = new Date(program.start);
    if( program.duration_sec ) progEnd = new Date(progStart.getTime()+program.duration_sec*1000);

    res.json({
      title: program.title || program.name || '番組情報なし',
      startTime: formatTime(progStart) ,
      endTime: formatTime(progEnd),
    });

  } catch (err) {
    console.error('[EPG API] Error fetching EPG:', err);
    res.status(500).json({ error: 'Failed to fetch EPG data' });
  }
});

// GET /epg/progrsms (デバッグ用)
// 例: /epg/programs?channel=32736-32736-1024&start=2026-08-31T00:00:00Z&end=2026-08-01T00:00:00Z
router.get('/programs', async (req, res) => {
  try {
    const { channel, start, end } = req.query;

    // 時刻指定がなければ「1日前」から「現在時刻」までをデフォルト範囲に設定
    const now = new Date();
    const startDate = start || new Date(now.getTime() - 24 * 60 * 60 * 1000 ).toISOString();
    const endDate   = end   || now.toISOString();

    // console.log(`${startDate}～${endDate}`);

    const epgData = await getEpgObject( channel, startDate, endDate);

    const programs = Array.isArray(epgData.programs) ? epgData.programs : [epgData.programs];

    // 取得した番組の中から「現在時刻が放送期間に含まれる番組」を抽出
    const currentProgram = programs.find(prog => {
      const progStart = new Date(prog.start || prog.startTime);
      const progEnd = new Date(progStart.getTime()+prog.duration_sec*1000);
      return progStart <= now && now < progEnd;
    }) || programs[programs.length - 1] || null; // 該当がなければ最新の1件

    // res.json(epgData);
    res.json(currentProgram);

  } catch (err) {
    console.error('[EPG API] Error fetching EPG:', err);
    res.status(500).json({ error: 'Failed to fetch EPG data' });
  }
});

// GET /epg/epg.xml (XMLTV形式返却)
//     引数なし：/config/env.js で定義したチャンネルの番組情報を取得する。
//     現時刻から１日先までを取得して返す。
router.get('/epg.xml', async (req, res) => {
  try {
    // const { channel, start, end } = req.query;
    console.log('[EPG XML] 全番組取得');

    // 番組表をXML形式で受け取る
    const xmlData = await generateXmltv() ;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xmlData);
  } catch (err) {
    console.error('[EPG XML API] Error generating XMLTV:', err);
    res.status(500).send('Failed to generate XMLTV data');
  }
});

module.exports = router;