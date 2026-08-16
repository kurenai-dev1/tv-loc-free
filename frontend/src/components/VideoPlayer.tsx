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
  const [isChangingChannel, setIsChangingChannel] = useState<boolean>(false); // 状態フラグを追加
  const [isMuted, setIsMuted] = useState<boolean>(true);

  // 1. 初回ロード時にチャンネル一覧を取得
  useEffect(() => {
    const fetchChannels = async () => {
      try {
        const res = await fetch('/api/channel/channels');
        const data: Channel[] = await res.json();
        
        const mainChannels = data.filter(c => !c.isSub);
        setAllChannels(mainChannels);

        const defaultGr = mainChannels.find(c => c.type === 'GR');
        if (defaultGr) setCurrentChannel(defaultGr);
      } catch (err) {
        console.error('Failed to fetch channels:', err);
      }
    };

    fetchChannels();
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
      // 一瞬黒画面にして前局の残像を見せないようにする
      video.style.opacity = '0';
      video.removeAttribute('src');
      video.load(); // ブラウザ内部のデコーダーバッファを強制解放
    }
    setStreamUrl(null);
  };

  // ストリーム開始 / 選局切り替え処理
  const startStream = async (channel: Channel) => {
    try {
      setIsChangingChannel(true); // ボタン連打防止

      // 既存の HLS と画面バッファを強制クリア
      resetHls();

      // バックエンドへ選局依頼（バックエンドが TS 生成まで待ってから 200 OK を返す）
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onid: channel.onid, tsid: channel.tsid, sid: channel.sid }),
      });

      if (!res.ok) {
        throw new Error('Stream start timed out or failed');
      }

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
        backBufferLength: 0,            // 過去バッファ即時除去
        liveSyncDurationCount: 1,       // 最新セグメント優先
        liveMaxLatencyDurationCount: 3,
      });

      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      setHlsInstance(hls);

hls.on(Hls.Events.MANIFEST_PARSED, () => {
  if (videoRef.current) {
    // 1. 最初からミュート解除（音あり）で再生を試みる
    videoRef.current.muted = false;
    
    videoRef.current.play().then(() => {
      // 再生成功（音ありでそのまま再生）
      setIsMuted(false);
    }).catch((err) => {
      console.warn('Autoplay with audio blocked. Falling back to muted play.', err);
      // ブラウザにブロックされた場合のみミュートにして再試行
      if (videoRef.current) {
        videoRef.current.muted = true;
        setIsMuted(true);
        videoRef.current.play().catch(console.error);
      }
    });
  }
});

      // ★ 新局の最初のフレームが実際に画面に描画された瞬間だけ opacity='1' に復帰
      const handlePlaying = () => {
        if (videoRef.current) {
          videoRef.current.style.opacity = '1';
        }
      };
      video.addEventListener('playing', handlePlaying, { once: true });

      // ネットワーク/メディアエラー時の復帰処理
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
 
         {/* ★ 選局中のオーバーレイ表示 */}
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
              pointerEvents: 'none' // 下のイベントを阻害しない
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
          </div>
        </div>
      </div>
    </div>
  );
};