import React from 'react';
import type { Channel, CurrentProgram } from '../../../types/tv';

interface Props {
  styles: Record<string, string>;
  onClose: () => void;
  selectedType: 'GR' | 'BS' | 'CS';
  channels: Channel[];
  currentChannel: Channel | null;
  epgMap: Record<string, CurrentProgram>;
  onSelectChannel: (channel: Channel) => void;
}

export const ChannelSelectModal: React.FC<Props> = ({
  styles,
  onClose,
  selectedType,
  channels,
  currentChannel,
  epgMap,
  onSelectChannel,
}) => {

//  if (!isOpen) return null;

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div
        className={styles.dialogContent}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <h3 className={styles.dialogTitle}>
            チャンネルを選択 ({selectedType})
          </h3>
          <button
            type="button"
            className={styles.dialogCloseBtn}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className={styles.dialogList}>
          {channels.map((ch) => {
            const chKey = `${ch.onid}-${ch.tsid}-${ch.sid}`;
            const epg = epgMap[chKey];
            const isSelected =
              currentChannel?.onid === ch.onid &&
              currentChannel?.sid === ch.sid;

            return (
              <button
                key={chKey}
                type="button"
                className={`${styles.dialogItem} ${
                  isSelected ? styles.selected : ''
                }`}
                onClick={() => {
                  onSelectChannel(ch);
                  onClose();
                }}
              >
                <div className={styles.itemChannelName}>{ch.name}</div>
                <div className={styles.itemProgram}>
                  <span className={styles.itemTime}>
                    {epg
                      ? `[${epg.startTime}～${epg.endTime}]`
                      : '[--:--～--:--]'}
                  </span>
                  <span className={styles.itemTitle}>
                    {epg ? epg.title : '番組情報なし'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};