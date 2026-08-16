require('dotenv').config();
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  EDCB_HOST: process.env.EDCB_HOST || 'http://127.0.0.1:5510',
  HLS_DIR: path.resolve(process.env.HLS_OUTPUT_DIR || './public/hls'),
  FFMPEG_ENCODER: process.env.FFMPEG_ENCODER || 'libx264' // 未指定時は CPU (libx264)
};
