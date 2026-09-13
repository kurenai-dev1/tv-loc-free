# はじめに
Jellyfin でのTV視聴方法にはいくつか方法があります。  
まず、本アプリを使うか、他の方法を使うかを考えて下さい。

* [Mirakurun](https://github.com/Chinachu/Mirakurun) を使う。
* [EDCB/Jellyfin ブリッジ](https://github.com/SomeDena786/EDCB-JellyfinDVR-bridge/tree/main)を使う。

本来なら上記で十分なはずですが、いくつか気になる点があったので簡易版を作りました。

# 相違点
Jellyfin のチャネル情報は日本の事情が考慮されておらず、**地デジ/BS/CS** が混在して一覧で表示されます。  
これに対して、TvLocFree では、設定ファイルで必要なチャンネルを設定し、それ以外のものは連携しません。  

# チャンネルの設定
backend/src/config.js 内に記載します。
```javascript
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
```
**id** は、ONID-TSID-SID です。  
チャンネルの一覧は、`http://localhost:3000/api/channel/channels/` で JSON 形式で確認できます。

> EDCBとTvLocFree があるPCが別であれば、localhost をIPアドレスに変えて下さい。

# Jellyfin の設定
「ライブTV チューナーのセットアップ」でAPIのURLを設定します。  
```text
http://localhost:3000/api/channel/channels.m3u
```
これだけでTV視聴が可能です。  
## 番組情報を送る
TV番組情報のプロバイダで、XmlTVを追加して、APIのURLを設定して下さい。  
```text
http://localhost:3000/api/epg/epg.xml
```
直近、１日分の番組情報が送られます。  
なお、本来１週間分を送れますが、録画機能を使わないので節約しています。  

## ライブ視聴が開始されず止まってしまう
10分後に再生が開始されました。  
たまたまかも知れませんが、私の使ったバージョンで発生したトラブルです。  
原因は、Jellyfin 側にあります。  
動画エンコードに使っている FFmpeg へのパラメータが正しくありません。  
設定で値を変更する事は難しいので、FFmpeg を起動するラッパーを使うのが一つの方法です。  

* FFmpeg_wrapper.exe というラッパーを作る(FFmpeg_original.exeを起動する)
* オリジナルの FFmpeg.exe -> FFmpeg_original.exe に名前変更
* ラッパーを FFmpeg.exe に変えて代わりに置く

 

