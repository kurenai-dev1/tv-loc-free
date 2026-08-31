require('dotenv').config();
const path = require('path');

// 画質プロファイルの定義辞書（マスターデータ）
const QUALITY_PROFILES = {
  '1080p': { height: 1080, width: 1920, videoBitrate: '2M',   audioBitrate: '128k' },
  '720p':  { height: 720,  width: 1280, videoBitrate: '1.5M', audioBitrate: '128k' },
  '480p':  { height: 480,  width: 854,  videoBitrate: '600k',   audioBitrate: '96k'  },
  '360p':  { height: 360,  width: 640,  videoBitrate: '300k', audioBitrate: '96k'  },
};

// .env からカンマ区切りで画質設定を取得（未指定の場合はデフォルト 720p,480p）
const envQualities = process.env.STREAM_QUALITIES 
  ? process.env.STREAM_QUALITIES.split(',').map(s => s.trim()) 
  : ['720p', '480p'];

// 有効なプロファイルのみをフィルタリング抽出
const activeQualities = envQualities.filter(q => QUALITY_PROFILES[q]);

// Jellyfin 公開用チャンネル定義
const jellyfinChannels = [
  { id: '32736-32736-1024',  name: 'NHK総合' },
  { id: '32737-32737-1032',  name: 'NHKEテレ１' },
  { id: '32738-32738-1040',  name: '日テレ１' },
  { id: '32741-32741-1064',  name: 'テレビ朝日' },
  { id: '32739-32739-1048',  name: 'ＴＢＳ１' },
  { id: '32742-32742-1072',  name: 'テレビ東京' },
  { id: '32740-32740-1056',  name: 'フジテレビ' },
  { id: '32391-32391-23608', name: 'TOKYO MX1'},
  { id: '32375-32375-24632', name: 'ｔｖｋ１'},
  { id: '32295-32295-29752', name: 'テレ玉１'},
];

module.exports = {
  PORT: process.env.PORT || 3000,
  EDCB_HOST: process.env.EDCB_HOST || 'http://127.0.0.1:5510',
  HLS_DIR: process.env.HLS_DIR || './public/hls',
  FFMPEG_ENCODER: process.env.FFMPEG_ENCODER || 'qsv', // 'qsv' or 'cpu'
  // 決定された画質リストと辞書をエクスポート
  ACTIVE_QUALITIES: activeQualities.length > 0 ? activeQualities : ['720p', '480p'],
  QUALITY_PROFILES,
  jellyfinChannels,
};