import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import styles from './VideoPlayer.module.css';

interface Channel {
  name: string;
  onid: number;
  tsid: number;
  sid: number;
  type: 'GR' | 'BS' | 'CS' | 'OTHERS';
  isSub?: boolean;
}

// 画質データの型定義
interface QualityLevel {
  index: number;
  label: string;
}

// ★ localStorage のキー名
const STORAGE_KEY = 'video_player_settings';

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // チャンネルデータ関連
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [selectedType, setSelectedType] = useState<'GR' | 'BS' | 'CS'>('GR');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);

  // 再生状態
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isChangingChannel, setIsChangingChannel] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // モード・画質設定用 State
  const [streamMode, setStreamMode] = useState<'multi' | 'single'>('multi');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>(''); // singleモード用
  const [qualities, setQualities] = useState<QualityLevel[]>([]);       // multiモード用
  const [currentQuality, setCurrentQuality] = useState<number>(-1);     // multiモード用

  // 1. 初回ロード時にチャンネル一覧・サーバー設定・localStorageの保存値を復元
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // ★ localStorage から前回の保存値を取得
        const savedRaw = localStorage.getItem(STORAGE_KEY);
        const saved = savedRaw ? JSON.parse(savedRaw) : null;

        // サーバー設定（モード、画質リスト）の取得
        const configRes = await fetch('/api/stream/config');
        if (configRes.ok) {
          const configData = await configRes.json();
          setStreamMode(configData.mode);
          setAvailableQualities(configData.qualities || []);

          // 画質の復元: 保存値があれば優先、なければ先頭の値
          if (saved?.quality && configData.qualities?.includes(saved.quality)) {
            setSelectedQuality(saved.quality);
          } else if (configData.qualities?.length > 0) {
            setSelectedQuality(configData.qualities[0]);
          }
        }

        // チャンネル取得
        const res = await fetch('/api/channel/channels');
        const data: Channel[] = await res.json();
        const mainChannels = data.filter(c => !c.isSub);
        setAllChannels(mainChannels);

        // 放送波タイプの復元（デフォルト GR）
        const targetType = saved?.selectedType || 'GR';
        setSelectedType(targetType);

        // チャンネルの復元
        let targetCh: Channel | undefined;
        if (saved?.channelKey) {
          const [onid, tsid, sid] = saved.channelKey.split('-').map(Number);
          targetCh = mainChannels.find(c => c.onid === onid && c.tsid === tsid && c.sid === sid);
        }

        // 保存されたチャンネルがない・見つからない場合は該当タイプの1曲目
        if (!targetCh) {
          targetCh = mainChannels.find(c => c.type === targetType);
        }

        if (targetCh) setCurrentChannel(targetCh);

      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      }
    };

    fetchInitialData();
  }, []);

  const filteredChannels = allChannels.filter(c => c.type === selectedType);

  // HLS インスタンスと Video タグの完全リセット関数
  const resetHls = () => {
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
  };

  // ストリーム開始 / 選局切り替え処理
  const startStream = async (channel: Channel, quality?: string) => {
    try {
      setIsChangingChannel(true);
      resetHls();

      const targetQuality = quality || selectedQuality;

      // ★ 視聴開始のタイミングで localStorage に設定をまとめて保存！
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          selectedType: channel.type,
          channelKey: `${channel.onid}-${channel.tsid}-${channel.sid}`,
          quality: targetQuality,
        }));
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
          quality: targetQuality
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
    } finally {
      setIsChangingChannel(false);
    }
  };

  // ストリーム停止処理
  const stopStream = async () => {
    resetHls();
    try {
      await fetch('/api/stream/stop', { method: 'POST' });
    } catch (err) {
      console.error('Failed to stop stream:', err);
    }
    setIsStreaming(false);
  };

  // ハートビート（5秒ごと）
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
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStreaming]);

  // HLS再生＆アタッチメント処理
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
          
          videoRef.current.play().then(() => {
            setIsMuted(false);
          }).catch((err) => {
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
        if (videoRef.current) {
          videoRef.current.style.opacity = '1';
        }
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
        if (videoRef.current) {
          videoRef.current.style.opacity = '1';
        }
      };
      video.addEventListener('playing', handlePlaying, { once: true });
    }
  }, [streamUrl]);

  // タブ閉じたときの安全停止
  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon('/api/stream/stop');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // 放送波タイプ切替時
  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as 'GR' | 'BS' | 'CS';
    setSelectedType(type);

    const firstCh = allChannels.find(c => c.type === type);
    if (firstCh) {
      setCurrentChannel(firstCh);
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
      if (isStreaming) {
        startStream(targetCh);
      }
    }
  };

  // 画質変更ハンドラー
  const handleQualityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
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

  // 音声解除用タップ処理
  const handleUserInteraction = () => {
    if (videoRef.current && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return (
    <div className={styles.container} onClick={handleUserInteraction}>
      <div className={styles.card}>
        {/* ビデオ表示領域 */}
        <div className={styles.screen}>
          <video ref={videoRef} controls playsInline />
 
          {/* 選局中のオーバーレイ表示 */}
          {isChangingChannel && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              color: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
              pointerEvents: 'none'
            }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                選局中...
              </div>
            </div>
          )}
        </div>

        {/* 下部コントロールパネル */}
        <div className={styles.controls} onClick={(e) => e.stopPropagation()}>
          <div className={styles.actionArea}>
            {!isStreaming ? (
              <button
                onClick={() => currentChannel && startStream(currentChannel)}
                disabled={isChangingChannel}
                className={`${styles.btn} ${styles.start}`}
              >
                {isChangingChannel ? '起動中...' : '▶ 視聴開始'}
              </button>
            ) : (
              <button
                onClick={stopStream}
                disabled={isChangingChannel}
                className={`${styles.btn} ${styles.stop}`}
              >
                ■ 視聴停止
              </button>
            )}
          </div>

          <div className={styles.selectArea}>
            {/* 1. 放送波切り替え */}
            <select
              value={selectedType}
              onChange={handleTypeChange}
              disabled={isChangingChannel}
              className={`${styles.select} ${styles.typeSelect}`}
            >
              <option value="GR">地デジ</option>
              <option value="BS">BS</option>
              <option value="CS">CS</option>
            </select>

            {/* 2. チャンネル（局）切り替え */}
            <select
              value={currentChannel ? `${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}` : ''}
              onChange={handleChannelChange}
              disabled={isChangingChannel}
              className={`${styles.select} ${styles.channelSelect}`}
            >
              {filteredChannels.map(ch => (
                <option key={`${ch.onid}-${ch.tsid}-${ch.sid}`} value={`${ch.onid}-${ch.tsid}-${ch.sid}`}>
                  {ch.name}
                </option>
              ))}
            </select>

            {/* 3. 解像度（画質）切り替え */}
            {streamMode === 'multi' ? (
              isStreaming && qualities.length > 0 && (
                <select
                  value={currentQuality}
                  onChange={handleQualityChange}
                  className={`${styles.select} ${styles.qualitySelect}`}
                >
                  <option value={-1}>画質: 自動</option>
                  {qualities.map((q) => (
                    <option key={q.index} value={q.index}>
                      {q.label}
                    </option>
                  ))}
                </select>
              )
            ) : (
              availableQualities.length > 0 && (
                <select
                  value={selectedQuality}
                  onChange={handleQualityChange}
                  disabled={isChangingChannel}
                  className={`${styles.select} ${styles.qualitySelect}`}
                >
                  {availableQualities.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};