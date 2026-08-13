■ 新規開発環境

backend 

mkdir backend
cd backend
npm init -y
npm install express cors dotenv
npm install --save-dev nodemon

package.json

{
  "name": "edcb-rocefuri-backend",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}


frontend

# frontend フォルダを作成して Vite プロジェクトをセットアップ
npm create vite@latest frontend -- --template react-ts
# カレントの場合
# npm create vite@latest . -- --template react-ts

cd frontend

# 必要なライブラリのインストール
npm install hls.js

vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/hls': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});


■ 実行

backend

cd backend
npm run dev


frontend

cd frontend
npm run dev

■ 確認

OID等の確認(EDCB直)
http://127.0.0.1:5510/api/EnumService

backend の確認
http://localhost:3000/api/stream?onid=【実局のONID】&tsid=【TSID】&sid=【SID】

NHK総合
http://localhost:3000/api/stream?onid=32736&tsid=32736&sid=1024




