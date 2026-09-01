import {
  Capacitor,
  CapacitorHttp,
  registerPlugin,
  type PermissionState,
  type PluginListenerHandle,
} from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ServiceProfile } from './profiles';
import type { SpeechTiming, SpeechWord } from './assessment';

export interface CloudSpeechResult extends SpeechTiming {
  text: string;
  final: boolean;
  confidence?: number;
  speechRate?: number;
}

interface CloudSpeechPlugin {
  checkPermissions(): Promise<{
    microphone: PermissionState;
  }>;
  requestPermissions(options: {
    permissions: string[];
  }): Promise<{
    microphone: PermissionState;
  }>;
  playAudio(options: {
    data: string;
    cacheName: string;
  }): Promise<void>;
  probeRecognition(options: {
    apiKey: string;
    url: string;
    resourceId: string;
  }): Promise<void>;
  startRecognition(options: {
    apiKey: string;
    url: string;
    resourceId: string;
  }): Promise<void>;
  stopRecognition(): Promise<void>;
  cancelRecognition(): Promise<void>;
  addListener(
    eventName: 'speechResult',
    listener: (event: CloudSpeechResult) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechError',
    listener: (event: { message: string; code?: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'speechState',
    listener: (event: { state: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const CloudSpeech = registerPlugin<CloudSpeechPlugin>('CloudSpeech');
const memoryAudio = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;

function requestId(): string {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function cacheKey(profile: ServiceProfile, voice: string, rate: number, text: string): string {
  const input = `${profile.id}\u001f${voice}\u001f${rate}\u001f${text}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193);
  }
  return `speech/${(hash >>> 0).toString(36)}.mp3`;
}

async function readCachedAudio(path: string): Promise<string> {
  if (memoryAudio.has(path)) return memoryAudio.get(path) || '';
  try {
    const file = await Filesystem.readFile({ path, directory: Directory.Cache });
    if (typeof file.data === 'string') {
      memoryAudio.set(path, file.data);
      return file.data;
    }
  } catch {
    // Cache misses are expected on first playback.
  }
  return '';
}

async function writeCachedAudio(path: string, data: string): Promise<void> {
  memoryAudio.set(path, data);
  try {
    await Filesystem.mkdir({
      path: 'speech',
      directory: Directory.Cache,
      recursive: true,
    });
    await Filesystem.writeFile({
      path,
      directory: Directory.Cache,
      data,
      recursive: true,
    });
  } catch {
    // In-memory playback remains available if the platform cache is unavailable.
  }
}

function parseSseAudio(raw: unknown): Uint8Array[] {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  const chunks: Uint8Array[] = [];
  let error = '';

  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('event:')) continue;
    const jsonText = value.startsWith('data:') ? value.slice(5).trim() : value;
    if (!jsonText.startsWith('{')) continue;
    try {
      const message = JSON.parse(jsonText);
      if (typeof message.data === 'string' && message.data) {
        const decoded = atob(message.data);
        const bytes = new Uint8Array(decoded.length);
        for (let index = 0; index < decoded.length; index += 1) {
          bytes[index] = decoded.charCodeAt(index);
        }
        chunks.push(bytes);
      } else if (message.code && ![0, 20000000].includes(Number(message.code))) {
        error = String(message.message || `语音合成错误 ${message.code}`);
      }
    } catch {
      // Ignore SSE control lines and incomplete trailing records.
    }
  }

  if (!chunks.length) {
    throw new Error(error || '云端语音没有返回可播放音频');
  }
  return chunks;
}

function bytesToBase64(parts: Uint8Array[]): string {
  let binary = '';
  for (const part of parts) {
    for (let offset = 0; offset < part.length; offset += 0x8000) {
      binary += String.fromCharCode(...part.subarray(offset, offset + 0x8000));
    }
  }
  return btoa(binary);
}

async function playAudioSource(source: string): Promise<void> {
  activeAudio?.pause();
  const audio = new Audio(source);
  activeAudio = audio;
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('云端语音播放失败'));
      audio.play().catch(reject);
    });
  } finally {
    if (activeAudio === audio) activeAudio = null;
  }
}

async function playCachedMp3(path: string, data: string): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await CloudSpeech.playAudio({
      data,
      cacheName: path.split('/').pop() || 'speech.mp3',
    });
    return;
  }
  await playAudioSource(`data:audio/mpeg;base64,${data}`);
}

export function canUseCloudRecognition(apiKey: string): boolean {
  return Capacitor.getPlatform() === 'android' && !!apiKey.trim();
}

export async function probeCloudRecognition(options: {
  profile: ServiceProfile;
  apiKey: string;
}): Promise<void> {
  if (!canUseCloudRecognition(options.apiKey)) {
    throw new Error('请在 Android App 内验证云端语音');
  }
  await CloudSpeech.probeRecognition({
    apiKey: options.apiKey,
    url: options.profile.speech.asrUrl,
    resourceId: options.profile.speech.asrResourceId,
  });
}

async function ensureMicrophonePermission(): Promise<void> {
  let status = await CloudSpeech.checkPermissions();
  if (status.microphone === 'granted') return;

  status = await CloudSpeech.requestPermissions({
    permissions: ['microphone'],
  });
  if (status.microphone !== 'granted') {
    throw new Error('麦克风权限被拒绝，请在系统设置中开启');
  }
}

export async function startCloudRecognition(options: {
  profile: ServiceProfile;
  apiKey: string;
  onResult?: (result: CloudSpeechResult) => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}): Promise<() => void> {
  await ensureMicrophonePermission();

  const handles: PluginListenerHandle[] = [];
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    await Promise.all(handles.map((handle) => handle.remove()));
  };

  handles.push(await CloudSpeech.addListener('speechResult', (event) => {
    options.onResult?.({
      ...event,
      words: Array.isArray(event.words)
        ? event.words.map((word: SpeechWord) => ({ ...word }))
        : [],
    });
  }));
  handles.push(await CloudSpeech.addListener('speechError', (event) => {
    cleanup();
    options.onError?.(new Error(event.message || '云端语音识别失败'));
  }));
  handles.push(await CloudSpeech.addListener('speechState', (event) => {
    if (event.state !== 'finished') return;
    cleanup();
    options.onEnd?.();
  }));

  try {
    await CloudSpeech.startRecognition({
      apiKey: options.apiKey,
      url: options.profile.speech.asrUrl,
      resourceId: options.profile.speech.asrResourceId,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  return () => {
    CloudSpeech.stopRecognition().catch(() => undefined);
  };
}

export async function cancelCloudRecognition(): Promise<void> {
  await CloudSpeech.cancelRecognition().catch(() => undefined);
}

export async function synthesizeCloudSpeech(options: {
  profile: ServiceProfile;
  apiKey: string;
  text: string;
  voice?: string;
  rate?: number;
}): Promise<void> {
  const voice = options.voice || options.profile.speech.defaultVoice;
  const rate = Math.max(0.5, Math.min(2, options.rate || 1));
  const path = cacheKey(options.profile, voice, rate, options.text);
  let audio = await readCachedAudio(path);

  if (!audio) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Api-Key': options.apiKey,
      'X-Api-Resource-Id': options.profile.speech.ttsResourceId,
      'X-Api-Request-Id': requestId(),
    };
    if (options.profile.speech.ttsAppKey) {
      headers['X-Api-App-Key'] = options.profile.speech.ttsAppKey;
    }

    const response = await CapacitorHttp.request({
      method: 'POST',
      url: options.profile.speech.ttsUrl,
      headers,
      data: {
        user: { id: requestId() },
        req_params: {
          text: options.text,
          speaker: voice,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: Math.round((rate - 1) * 100),
          },
          additions: JSON.stringify({ explicit_language: 'en' }),
        },
      },
      responseType: 'text',
      connectTimeout: 10_000,
      readTimeout: 30_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`云端语音连接失败（HTTP ${response.status}）`);
    }
    audio = bytesToBase64(parseSseAudio(response.data));
    await writeCachedAudio(path, audio);
  }

  await playCachedMp3(path, audio);
}
