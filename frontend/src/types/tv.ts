// src/types/tv.ts

export interface Channel {
  name: string;
  onid: number;
  tsid: number;
  sid: number;
  type: 'GR' | 'BS' | 'CS' | 'OTHERS';
  isSub?: boolean;
}

export interface CurrentProgram {
  title: string;
  startTime: string;
  endTime: string;
}
