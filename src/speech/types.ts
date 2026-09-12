export interface SpeechWord {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}

export interface SpeechTiming {
  durationMs?: number;
  voicedMs?: number;
  longPauses?: number;
  words?: SpeechWord[];
}
