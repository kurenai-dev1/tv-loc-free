import { useState, useEffect } from 'react';

const STORAGE_KEY = 'video_player_settings';

export interface PlayerSettings {
  selectedType: 'GR' | 'BS' | 'CS';
  channelKey: string | null; // "onid-tsid-sid"
  quality: string;
}

const DEFAULT_SETTINGS: PlayerSettings = {
  selectedType: 'GR',
  channelKey: null,
  quality: '',
};

export const usePlayerSettings = () => {
  const [settings, setSettings] = useState<PlayerSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // 視聴開始時などに呼ぶ保存関数
  const saveSettings = (newSettings: Partial<PlayerSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save player settings:', err);
      }
      return updated;
    });
  };

  return { settings, saveSettings };
};