import { VideoPlayer } from './components/VideoPlayer';
import styles from './App.module.css';

export const App = () => {
  return (
    <div className={styles.container}>
      <VideoPlayer />
    </div>
  );
};