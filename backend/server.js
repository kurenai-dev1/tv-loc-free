const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./src/config/env');
const streamRoutes = require('./src/routes/stream');

const app = express();

app.use(cors());
app.use(express.json());

// APIルーティング
app.use('/api', streamRoutes);

// 生成された HLS ファイルを静的配信 (CORS許可)
app.use('/hls', express.static(path.join(__dirname, 'public/hls')));

app.listen(config.PORT, () => {
  console.log(`Backend server running on http://localhost:${config.PORT}`);
});