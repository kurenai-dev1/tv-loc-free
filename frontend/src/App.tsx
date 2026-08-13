import React from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import styles from './App.module.css';

export const App = () => {
  return (
    <div className={styles.container}>
      <h1>EDCB ロケフリ WebUI</h1>
      <VideoPlayer />
    </div>
  );
};