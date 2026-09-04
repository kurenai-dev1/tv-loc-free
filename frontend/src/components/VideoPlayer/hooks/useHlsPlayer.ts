// hooks/useHlsPlayer.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import type { Channel } from '../../../types/tv';

interface QualityLevel {
  index: number;
  label: string;
}

const STORAGE_KEY = 'video_player_settings';

export const useHlsPlayer = (
  selectedQuality: string,
  setSelectedQuality: (q: string) => void
) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // 再生・配信状態
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isChangingChannel, setIsChangingChannel] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // 画質関連
  const [streamMode, setStreamMode] = useState<'multi' | 'single'>('multi');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);

  // エラー状態
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // HLSおよびVideo要素のリセット
  const resetHls = useCallback(() => {
    if (hlsInstance) {
      hlsInstance.destroy();
      setHlsInstance(null);
    }
    if (videoRef.current) {
      const video = videoRef.current;
      video.pause();
      video.style.opacity = '0';
      video.removeAttribute('src');
      video.load();
    }
    setStreamUrl(null);
    setQualities([]);
    setCurrentQuality(-1);
  }, [hlsInstance]);

  // 配信停止処理
  const stopStream = useCallback(async (reason?: string) => {
    resetHls();
    try {
      await fetch('/api/stream/stop', { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop stream:', err);
    }
    setIsStreaming(false);
    if (reason) {
      setErrorMessage(reason);
    }
  }, [resetHls]);

  // 配信開始処理
  const startStream = useCallback(async (channel: Channel, quality?: string) => {
    try {
      setErrorMessage(null);
      setIsChangingChannel(true);
      resetHls();

      const targetQuality = quality || selectedQuality;

      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            selectedType: channel.type,
            channelKey: `${channel.onid}-${channel.tsid}-${channel.sid}`,
            quality: targetQuality,
          })
        );
      } catch (e) {
        console.error('Failed to save settings to localStorage:', e);
      }

      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onid: channel.onid,
          tsid: channel.tsid,
          sid: channel.sid,
          quality: targetQuality,
        }),
      });

      if (!res.ok) throw new Error('Stream start timed out or failed');

      const data = await res.json();

      if (data.playlist) {
        setStreamUrl(`${data.playlist}?t=${Date.now()}`);
        setIsStreaming(true);
      }
    } catch (err) {
      console.error('Failed to start stream:', err);
      setIsStreaming(false);
      resetHls();
      setErrorMessage('配信の開始に失敗しました。');
    } finally {
      setIsChangingChannel(false);
    }
  }, [selectedQuality, resetHls]);

  // ハートビート処理
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isStreaming) {
      intervalId = setInterval(async () => {
        if (isChangingChannel) return;

        try {
          const res = await fetch('/api/stream/heartbeat', { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            if (data.isStreaming === false && !isChangingChannel) {
              console.warn('[Heartbeat] Server stream process has died.');
              stopStream('サーバー側で配信処理（FFmpeg）が停止しました。');
            }
          }
        } catch (err) {
          console.error('Heartbeat failed:', err);
        }
      }, 5000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStreaming, isChangingChannel, stopStream]);

  // HLS.js の初期化・再生監視
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 0,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      setHlsInstance(hls);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.levels.length > 0) {
          const levelList: QualityLevel[] = hls.levels.map((level, index) => ({
            index,
            label: `${level.height}p`,
          }));
          setQualities(levelList);
        }

        if (videoRef.current) {
          videoRef.current.muted = false;
          videoRef.current
            .play()
            .then(() => setIsMuted(false))
            .catch((err) => {
              console.warn('Autoplay with audio blocked. Falling back to muted play.', err);
              if (videoRef.current) {
                videoRef.current.muted = true;
                setIsMuted(true);
                videoRef.current.play().catch(console.error);
              }
            });
        }
      });

      const handlePlaying = () => {
        if (videoRef.current) videoRef.current.style.opacity = '1';
      };
      video.addEventListener('playing', handlePlaying, { once: true });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              break;
          }
        }
      });

      return () => {
        video.removeEventListener('playing', handlePlaying);
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.muted = true;
      video.play().catch(console.error);

      const handlePlaying = () => {
        if (videoRef.current) videoRef.current.style.opacity = '1';
      };
      video.addEventListener('playing', handlePlaying, { once: true });
    }
  }, [streamUrl]);

  // タブ閉じ・画面遷移時の停止送信
  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon('/api/stream/stop');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 画質変更処理
  const handleQualityChange = (e: React.ChangeEvent<HTMLSelectElement>, currentChannel: Channel | null) => {
    const val = e.target.value;

    if (streamMode === 'multi') {
      const levelIndex = Number(val);
      setCurrentQuality(levelIndex);
      if (hlsInstance) {
        hlsInstance.currentLevel = levelIndex;
      }
    } else {
      setSelectedQuality(val);
      if (currentChannel && isStreaming) {
        startStream(currentChannel, val);
      }
    }
  };

  const handleUserInteraction = () => {
    if (videoRef.current && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return {
    videoRef,
    isStreaming,
    isChangingChannel,
    errorMessage,
    setErrorMessage,
    streamMode,
    setStreamMode,
    availableQualities,
    setAvailableQualities,
    qualities,
    currentQuality,
    startStream,
    stopStream,
    handleQualityChange,
    handleUserInteraction,
  };
};