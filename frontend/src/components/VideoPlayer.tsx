import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import styles from './VideoPlayer.module.css';

interface Channel {
  onid: number;
  tsid: number;
  sid: number;
  name?: string;
}

interface VideoPlayerProps {
  defaultChannel?: Channel;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  defaultChannel = { onid: 32736, tsid: 32736, sid: 1024, name: 'NHK総合' }
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentChannel, setCurrentChannel] = useState<Channel>(defaultChannel);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);

  // ★ 1. isStreaming State の定義
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // 配信開始処理
  const startStream = async (channel: Channel) => {
    try {
      const { onid, tsid, sid } = channel;
      const res = await fetch(`/api/stream?onid=${onid}&tsid=${tsid}&sid=${sid}`);
      const data = await res.json();

      if (data.playlist) {
        setStreamUrl(data.playlist);
        setIsStreaming(true); // ★ 配信中に更新
      }
    } catch (err) {
      console.error('Failed to start stream:', err);
    }
  };

  // 配信停止処理
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
    setIsStreaming(false); // ★ 停止状態に更新
  };

  // 視聴開始/終了 トグルボタン
  const handleToggleStream = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isStreaming) {
      stopStream();
    } else {
      startStream(currentChannel);
    }
  };

  // ★ 2. ハートビート通知処理 (isStreaming が true の間だけ5秒おきに送信)
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    if (isStreaming) {
      intervalId = setInterval(async () => {
        try {
          await fetch('/api/stream/heartbeat', { method: 'POST' });
        } catch (err) {
          console.error('Heartbeat send failed:', err);
        }
      }, 5000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
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

      return () => {
        hls.destroy();
      };
    }
  }, [streamUrl]);

  // ブラウザ閉じ・タブ閉じ時の自動停止
  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon('/api/stream/stop');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 画面タップでミュート解除
  const handleUserInteraction = () => {
    if (videoRef.current && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return (
    <div className={styles.playerContainer} onClick={handleUserInteraction}>
      <div className={styles.controls}>
        <button
          onClick={handleToggleStream}
          className={isStreaming ? styles.stopButton : styles.startButton}
        >
          {isStreaming ? '■ 視聴終了' : '▶ 視聴開始'}
        </button>
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