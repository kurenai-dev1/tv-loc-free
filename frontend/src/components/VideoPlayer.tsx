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

interface QualityLevel {
  index: number;
  label: string;
}

// 番組情報の型定義
interface CurrentProgram {
  title: string;
  startTime: string; // "19:00"
  endTime: string;   // "19:30"
}

const STORAGE_KEY = 'video_player_settings';

export const VideoPlayer: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  // チャンネルデータ関連
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [selectedType, setSelectedType] = useState<'GR' | 'BS' | 'CS'>('GR');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);

  // 各チャンネルの番組情報を保持する Map（キー: "onid-tsid-sid"）
  const [epgMap, setEpgMap] = useState<Record<string, CurrentProgram>>({});

  // 再生状態
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [hlsInstance, setHlsInstance] = useState<Hls | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isChangingChannel, setIsChangingChannel] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // モード・画質設定用 State
  const [streamMode, setStreamMode] = useState<'multi' | 'single'>('multi');
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);

  // エラーメッセージ用のステート
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 初回データ取得
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const savedRaw = localStorage.getItem(STORAGE_KEY);
        const saved = savedRaw ? JSON.parse(savedRaw) : null;

        const configRes = await fetch('/api/stream/config');
        if (configRes.ok) {
          const configData = await configRes.json();
          setStreamMode(configData.mode);
          setAvailableQualities(configData.qualities || []);

          if (saved?.quality && configData.qualities?.includes(saved.quality)) {
            setSelectedQuality(saved.quality);
          } else if (configData.qualities?.length > 0) {
            setSelectedQuality(configData.qualities[0]);
          }
        }

        const res = await fetch('/api/channel/channels');
        const data: Channel[] = await res.json();
        const mainChannels = data.filter(c => !c.isSub);
        setAllChannels(mainChannels);

        const targetType = saved?.selectedType || 'GR';
        setSelectedType(targetType);

        let targetCh: Channel | undefined;
        if (saved?.channelKey) {
          const [onid, tsid, sid] = saved.channelKey.split('-').map(Number);
          targetCh = mainChannels.find(c => c.onid === onid && c.tsid === tsid && c.sid === sid);
        }

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

  // 表示対象の各チャンネルごとに個別に API を呼び出して番組情報を更新
  const fetchCurrentEpgForFilteredChannels = () => {
    filteredChannels.forEach(async (ch) => {
      const chKey = `${ch.onid}-${ch.tsid}-${ch.sid}`;

      try {
        const res = await fetch(
          `/api/epg/current?channel=${chKey}`
        );
        if (res.ok) {
          const data: CurrentProgram | null = await res.json();
          if (data) {
            setEpgMap(prev => ({
              ...prev,
              [chKey]: data,
            }));
          }
        }
      } catch (err) {
        console.error(`Failed to fetch EPG for ${chKey}:`, err);
      }
    });
  };

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

  const startStream = async (channel: Channel, quality?: string) => {
    try {
      setErrorMessage(null);
      setIsChangingChannel(true);
      resetHls();

      const targetQuality = quality || selectedQuality;

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
      setErrorMessage('配信の開始に失敗しました。');
    } finally {
      setIsChangingChannel(false);
    }
  };

  const stopStream = async (reason?: string) => {
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
  };

  // ★ チャンネル変更中の停止検知を抑止するハートビート処理
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isStreaming) {
      intervalId = setInterval(async () => {
        // チャンネル変更中はサーバー側の停止状態チェックをスキップ
        if (isChangingChannel) {
          return;
        }

        try {
          const res = await fetch('/api/stream/heartbeat', { method: 'POST' });
          if (res.ok) {
            const data = await res.json();
            // タイミングによる誤検知を防ぐため、再度 isChangingChannel を確認
            if (data.isStreaming === false && !isChangingChannel) {
              console.warn('[Heartbeat] Server stream process has died. Cleaning up...');
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
  }, [isStreaming, isChangingChannel]); // ★ isChangingChannel を依存配列に追加

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

  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon('/api/stream/stop');
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

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

  const handleUserInteraction = () => {
    if (videoRef.current && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  return (
    <div className={styles.container} onClick={handleUserInteraction}>
      <div className={styles.card}>
        <div className={styles.screen}>
          <video ref={videoRef} controls playsInline />

          {isChangingChannel && (
            <div className={styles.loadingOverlay}>
              <div className={styles.loadingText}>選局中...</div>
            </div>
          )}

          {errorMessage && (
            <div className={styles.overlay}>
              <p className={styles.errorMessage}>{errorMessage}</p>
              <button 
                className={styles.closeBtn} 
                onClick={() => setErrorMessage(null)}
              >
                閉じる
              </button>
            </div>
          )}
        </div>

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
                onClick={() => stopStream()}
                disabled={isChangingChannel}
                className={`${styles.btn} ${styles.stop}`}
              >
                ■ 視聴停止
              </button>
            )}
          </div>

          <div className={styles.selectArea}>
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

            {/* フォーカス時（セレクトボックスを開いた時）に対象チャンネル分を個別取得 */}
            <select
              value={currentChannel ? `${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}` : ''}
              onChange={handleChannelChange}
              onFocus={fetchCurrentEpgForFilteredChannels}
              disabled={isChangingChannel}
              className={`${styles.select} ${styles.channelSelect}`}
            >
              {/* 選択後の表示用（閉じている時）：局名のみ表示 */}
              {currentChannel && (
                <option value={`${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}`} hidden>
                  {currentChannel.name}
                </option>
              )}

              {/* プルダウン展開時のリスト */}
              {filteredChannels.map(ch => {
                const chKey = `${ch.onid}-${ch.tsid}-${ch.sid}`;
                const epg = epgMap[chKey];

                const timeStr = epg ? `[${epg.startTime}～${epg.endTime}]` : '[ --:--～--:-- ]';
                const titleStr = epg ? epg.title : '番組情報なし';

                return (
                  <option key={chKey} value={chKey}>
                    {ch.name.padEnd(10, ' ')} {timeStr} {titleStr}
                  </option>
                );
              })}
            </select>

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