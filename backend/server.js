const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./src/config/env');
const streamRoutes = require('./src/routes/stream');
const channelRoutes = require('./src/routes/channels'); // ★ 追加

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text()); // ★ sendBeacon 対策 (タブ閉じ時の停止通知用)

// 1. APIルーティング
app.use('/api/stream', streamRoutes);
app.use('/api/channel', channelRoutes); // ★ 追加 (/api/channels)

// 2. 生成された HLS ファイルを静的配信 (CORS許可)
app.use('/hls', express.static(path.join(__dirname, 'public/hls')));

// 3. フロントエンドビルドファイルの静的配信
app.use(express.static(path.join(__dirname, 'dist')));

// 4. SPA（Single Page Application）用フォールバック処理
// どのAPI/ファイルにもマッチしなかった場合は index.html を返す
// × app.get('*', (req, res) => {
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(config.PORT, () => {
  console.log(`Backend server running on http://localhost:${config.PORT}`);
});