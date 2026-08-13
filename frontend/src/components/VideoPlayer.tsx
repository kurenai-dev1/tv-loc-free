import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import styles from './VideoPlayer.module.css';

interface Channel {
  name: string;
  onid: number;
  tsid: number;
  sid: number;
  type: 'GR' | 'BS' | 'CS' | 'OTHERS';
  isSub: boolean;
}

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // チャンネルデータ関連
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [selectedType, setSelectedType] = useState<'GR' | 'BS' | 'CS'>('GR'); // 1. 放送波タイプ
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null); // 2. 選択中の局

  // 再生状態
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // 1. 初回ロード時にチャンネル一覧を取得
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        const res = await fetch('/api/channels');
        const data: Channel[] = await res.json();
        
        // メインチャンネル（isSub === false）のみ抽出
        const mainChannels = data.filter(c => !c.isSub);
        setAllChannels(mainChannels);

        // 初期選択：地デジの最初の局（例：NHK総合）
        const defaultGr = mainChannels.find(c => c.type === 'GR');
        if (defaultGr) setCurrentChannel(defaultGr);
      } catch (err) {
        console.error('Failed to fetch channels:', err);
      }
    };

    fetchChannels();
  }, []);

  // 現在の放送波タイプに該当する局リスト（2つ目のドロップダウン用）
  const filteredChannels = allChannels.filter(c => c.type === selectedType);

  // 放送波タイプ切替時：切り替えた波の最初の局を自動選択
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as 'GR' | 'BS' | 'CS';
    setSelectedType(type);

    const firstCh = allChannels.find(c => c.type === type);
    if (firstCh) {
      setCurrentChannel(firstCh);
      // すでに視聴中なら即時チャンネル切り替え
      if (isStreaming) {
        startStream(firstCh);
      }
    }
  };

  // 局切替時
  const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [onid, tsid, sid] = e.target.value.split('-').map(Number);
    const targetCh = allChannels.find(c => c.onid === onid && c.tsid === tsid && c.sid === sid);
    if (targetCh) {
      setCurrentChannel(targetCh);
      // すでに視聴中なら即時チャンネル切り替え
      if (isStreaming) {
        startStream(targetCh);
      }
    }
  };

  // ストリーム開始処理
  const startStream = async (channel: Channel) => {
    try {
      const res = await fetch(`/api/stream?onid=${channel.onid}&tsid=${channel.tsid}&sid=${channel.sid}`);
      const data = await res.json();

      if (data.playlist) {
        setStreamUrl(data.playlist);
        setIsStreaming(true);
      }
    } catch (err) {
      console.error('Failed to start stream:', err);
    }
  };

  // ストリーム停止処理
  const stopStream = async () => {
    if (hlsInstance) {
      hlsInstance.destroy();
      setHlsInstance(null);
    }
    try {
      await fetch('/api/stream/stop', { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop stream:', err);
    }
    setStreamUrl(null);
    setIsStreaming(false);
  };

  // トグルボタン
  const handleToggleStream = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStreaming) {
      stopStream();
    } else if (currentChannel) {
      startStream(currentChannel);
    }
  };

  // ハートビート
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isStreaming) {
      intervalId = setInterval(async () => {
        try {
          await fetch('/api/stream/heartbeat', { method: 'POST' });
        } catch (err) {
          console.error('Heartbeat failed:', err);
        }
      }, 5000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isStreaming]);

  // HLS再生紐付け
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      setHlsInstance(hls);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true;
        video.play().catch(console.error);
      });

      return () => { hls.destroy(); };
    }
  }, [streamUrl]);

  // タブ閉じ時停止
  useEffect(() => {
    const handleBeforeUnload = () => { navigator.sendBeacon('/api/stream/stop'); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => { window.removeEventListener('beforeunload', handleBeforeUnload); };
  }, []);

  // ミュート解除
  const handleUserInteraction = () => {
    if (videoRef.current && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return (
    <div className={styles.playerContainer} onClick={handleUserInteraction}>
      <div className={styles.controls} onClick={(e) => e.stopPropagation()}>
        {/* 開始/終了 ボタン */}
        <button
          onClick={handleToggleStream}
          className={isStreaming ? styles.stopButton : styles.startButton}
        >
          {isStreaming ? '■ 視聴終了' : '▶ 視聴開始'}
        </button>

        {/* 1. 放送波選択 (地デジ / BS / CS) */}
        <select value={selectedType} onChange={handleTypeChange} className={styles.select}>
          <option value="GR">地デジ</option>
          <option value="BS">BS</option>
          <option value="CS">CS</option>
        </select>

        {/* 2. チャンネル（局）選択 */}
        <select
          value={currentChannel ? `${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}` : ''}
          onChange={handleChannelChange}
          className={styles.select}
        >
          {filteredChannels.map(ch => (
            <option key={`${ch.onid}-${ch.tsid}-${ch.sid}`} value={`${ch.onid}-${ch.tsid}-${ch.sid}`}>
              {ch.name}
            </option>
          ))}
        </select>
      </div>

      {isStreaming && isMuted && (
        <div className={styles.unmuteNotice}>
          🔊 画面をタップして音声をオン
        </div>
      )}

      <div className={styles.videoWrapper}>
        <video ref={videoRef} controls playsInline autoPlay muted />
      </div>
    </div>
  );
};