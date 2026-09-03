import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeSpeech = vi.hoisted(() => ({
  addListener: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  startRecognition: vi.fn(),
  stopRecognition: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'android',
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
  registerPlugin: () => nativeSpeech,
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: {
    Cache: 'CACHE',
  },
  Filesystem: {
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { startCloudRecognition } from '../src/speech/cloud';

const profile = {
  id: 'global',
  label: '海外',
  llm: {
    protocol: 'responses',
    baseUrl: 'https://example.com',
    defaultModel: 'model',
  },
  speech: {
    asrUrl: 'wss://example.com/asr',
    asrResourceId: 'asr',
    ttsUrl: 'https://example.com/tts',
    ttsResourceId: 'tts',
    defaultVoice: 'voice',
  },
} as const;

describe('speech input lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeSpeech.addListener.mockResolvedValue({
      remove: vi.fn().mockResolvedValue(undefined),
    });
    nativeSpeech.startRecognition.mockResolvedValue(undefined);
    nativeSpeech.stopRecognition.mockResolvedValue(undefined);
  });

  it('finishes the first permission request before starting recognition', async () => {
    nativeSpeech.checkPermissions.mockResolvedValue({
      microphone: 'prompt',
    });
    nativeSpeech.requestPermissions.mockResolvedValue({
      microphone: 'granted',
    });

    await startCloudRecognition({
      profile,
      apiKey: 'speech-key',
    });

    expect(nativeSpeech.requestPermissions).toHaveBeenCalledWith({
      permissions: ['microphone'],
    });
    expect(nativeSpeech.startRecognition).toHaveBeenCalledOnce();
    expect(
      nativeSpeech.requestPermissions.mock.invocationCallOrder[0],
    ).toBeLessThan(
      nativeSpeech.startRecognition.mock.invocationCallOrder[0],
    );
  });

  it('does not start recognition when permission remains denied', async () => {
    nativeSpeech.checkPermissions.mockResolvedValue({
      microphone: 'prompt',
    });
    nativeSpeech.requestPermissions.mockResolvedValue({
      microphone: 'denied',
    });

    await expect(startCloudRecognition({
      profile,
      apiKey: 'speech-key',
    })).rejects.toThrow('麦克风权限被拒绝');

    expect(nativeSpeech.startRecognition).not.toHaveBeenCalled();
    expect(nativeSpeech.addListener).not.toHaveBeenCalled();
  });

  it('stops capture recording before reading input for analysis', () => {
    const source = readFileSync('js/views.js', 'utf8');
    const captureView = source.slice(
      source.indexOf('export function viewCapture'),
      source.indexOf('function renderCaptureResult'),
    );
    const analysisHandler = captureView.slice(
      captureView.indexOf("analyzeButton.addEventListener('click'"),
    );

    expect(analysisHandler.indexOf('stopCaptureRecording();'))
      .toBeLessThan(analysisHandler.indexOf('const text = ta.value.trim();'));
    expect(analysisHandler).toContain('micButton.disabled = true;');
    expect(analysisHandler).toContain('ta.readOnly = true;');
  });

  it('locks the practice input and clears recording state before judging', () => {
    const source = readFileSync('js/views.js', 'utf8');
    const drillView = source.slice(
      source.indexOf('export function drillCard'),
      source.indexOf('export function viewHome'),
    );
    const submitHandler = drillView.slice(
      drillView.indexOf("'-go')?.addEventListener('click'"),
      drillView.indexOf('function finish'),
    );

    expect(submitHandler.indexOf("lockInput('is-submitting');"))
      .toBeLessThan(submitHandler.indexOf('await L.judge'));
    expect(drillView).toContain("micButton?.classList.remove('rec')");
    expect(drillView).toContain('ta.readOnly = true;');
  });
});
