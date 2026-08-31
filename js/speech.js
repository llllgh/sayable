/* speech.js — 语音输入/朗读。
   为什么重要：目标能力是「会议里被点到时能一口气说出来」，
   打字练出来的是写作检索，不是口语检索。所以答题默认用嘴。 */

import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!SR;
export const canSpeak = () => 'speechSynthesis' in window;

let rec = null;

export function listen({ lang = 'en-US', onText, onEnd, onError }) {
  if (!SR) { onError?.(new Error('当前浏览器不支持语音输入，请用键盘输入')); return () => {}; }
  stop();
  rec = new SR();
  rec.lang = lang; rec.continuous = true; rec.interimResults = true;
  let finalText = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
    }
    onText?.((finalText + interim).trim(), finalText.trim());
  };
  rec.onerror = e => onError?.(new Error(e.error === 'not-allowed' ? '麦克风权限被拒绝' : ('语音识别出错：' + e.error)));
  rec.onend = () => { onEnd?.(finalText.trim()); rec = null; };
  try { rec.start(); } catch (e) { onError?.(e); }
  return stop;
}
export function stop() { try { rec?.stop(); } catch (e) {} rec = null; }

export async function say(text, { rate = 0.94 } = {}) {
  if (Capacitor.isNativePlatform() && text) {
    try {
      await TextToSpeech.stop();
      await TextToSpeech.speak({
        text: text.replace(/\b([XYZ])\b/g, 'something'),
        lang: 'en-US',
        rate,
        pitch: 1,
        volume: 1,
        queueStrategy: 1,
      });
      return;
    } catch (e) {
      // Fall through to Web Speech if the device has no configured TTS engine.
    }
  }
  if (!canSpeak() || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\b([XYZ])\b/g, 'something'));
    u.lang = 'en-US'; u.rate = rate;
    const v = speechSynthesis.getVoices().find(v => /en-US/i.test(v.lang) && /natural|google|samantha|alloy/i.test(v.name))
           || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch (e) {}
}
