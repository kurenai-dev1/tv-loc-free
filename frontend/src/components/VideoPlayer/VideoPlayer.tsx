import React, { useEffect, useState } from 'react';
import styles from './VideoPlayer.module.css';
import type { Channel, CurrentProgram } from '../../types/tv';
import { ChannelSelectModal } from './components/ChannelSelectModal';
import { useHlsPlayer } from './hooks/useHlsPlayer';

const STORAGE_KEY = 'video_player_settings';

export const VideoPlayer: React.FC = () => {
  // チャンネル・EPG関連 State
  const [allChannels, setAllChannels] = useState<Channel[]>([]);
  const [selectedType, setSelectedType] = useState<'GR' | 'BS' | 'CS'>('GR');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [epgMap, setEpgMap] = useState<Record<string, CurrentProgram>>({});

  const [selectedQuality, setSelectedQuality] = useState<string>('');
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);

  // カスタムフックの呼び出し
  const {
    videoRef,
    isStreaming,
    isVisitor, // ★
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
  } = useHlsPlayer(selectedQuality, setSelectedQuality);


  // チャンネル選択のみを無効化する判定
  const isChannelSelectDisabled = isChangingChannel || isVisitor;

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
        const mainChannels = data.filter((c) => !c.isSub);
        setAllChannels(mainChannels);

        const targetType = saved?.selectedType || 'GR';
        setSelectedType(targetType);

        let targetCh: Channel | undefined;
        if (saved?.channelKey) {
          const [onid, tsid, sid] = saved.channelKey.split('-').map(Number);
          targetCh = mainChannels.find(
            (c) => c.onid === onid && c.tsid === tsid && c.sid === sid
          );
        }

        if (!targetCh) {
          targetCh = mainChannels.find((c) => c.type === targetType);
        }

        if (targetCh) setCurrentChannel(targetCh);
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      }
    };

    fetchInitialData();
  }, [setStreamMode, setAvailableQualities]);

  const filteredChannels = allChannels.filter((c) => c.type === selectedType);

  const fetchCurrentEpgForFilteredChannels = () => {
    filteredChannels.forEach(async (ch) => {
      const chKey = `${ch.onid}-${ch.tsid}-${ch.sid}`;
      try {
        const res = await fetch(`/api/epg/current?channel=${chKey}`);
        if (res.ok) {
          const data: CurrentProgram | null = await res.json();
          if (data) {
            setEpgMap((prev) => ({ ...prev, [chKey]: data }));
          }
        }
      } catch (err) {
        console.error(`Failed to fetch EPG for ${chKey}:`, err);
      }
    });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as 'GR' | 'BS' | 'CS';
    setSelectedType(type);

    const firstCh = allChannels.find((c) => c.type === type);
    if (firstCh) {
      setCurrentChannel(firstCh);
      if (isStreaming) {
        startStream(firstCh);
      }
    }
  };

  const changeChannel = (targetCh: Channel) => {
    setCurrentChannel(targetCh);
    if (isStreaming) {
      startStream(targetCh);
    }
  };

  const handleSelectOpen = (
    e: React.MouseEvent<HTMLSelectElement> | React.KeyboardEvent<HTMLSelectElement>
  ) => {
    e.preventDefault();
    if (isChangingChannel) return;

    fetchCurrentEpgForFilteredChannels();
    setIsDialogOpen(true);
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
              disabled={isChannelSelectDisabled} // isVisitor 
              className={`${styles.select} ${styles.typeSelect}`}
            >
              <option value="GR">地デジ</option>
              <option value="BS">BS</option>
              <option value="CS">CS</option>
            </select>

            <select
              value={
                currentChannel
                  ? `${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}`
                  : ''
              }
              onMouseDown={(e) => {
              if (isChannelSelectDisabled) return; // isVisitor なら無効
                handleSelectOpen(e);
              }}
              onKeyDown={(e) => {
                if (isChannelSelectDisabled) return; // isVisitor なら無効
                if (e.key === 'Enter' || e.key === ' ') handleSelectOpen(e);
              }}
              disabled={isChannelSelectDisabled} // isVisitor の場合も
              className={`${styles.select} ${styles.channelSelect}`}
            >
              {currentChannel ? (
                <option
                  value={`${currentChannel.onid}-${currentChannel.tsid}-${currentChannel.sid}`}
                >
                  {!isVisitor ? currentChannel.name : ' (視聴専用：他端末で操作中)'}
                </option>
              ) : (
                <option value="">チャンネルを選択</option>
              )}
            </select>

            {streamMode === 'multi' ? (
              isStreaming && qualities.length > 0 && (
                <select
                  value={currentQuality}
                  onChange={(e) => handleQualityChange(e, currentChannel)}
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
                  onChange={(e) => handleQualityChange(e, currentChannel)}
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

      {isDialogOpen && (
        <ChannelSelectModal
          styles={styles}
          onClose={() => setIsDialogOpen(false)}
          selectedType={selectedType}
          channels={filteredChannels}
          currentChannel={currentChannel}
          epgMap={epgMap}
          onSelectChannel={changeChannel}
        />
      )}
    </div>
  );
};