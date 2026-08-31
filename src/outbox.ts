import * as Llm from '../js/llm.js';
import * as Store from '../js/store.js';
import { isOnline } from './platform/network';

let processing = false;

export async function processOutbox(limit = 3): Promise<number> {
  if (processing || !Store.isLive() || !isOnline()) return 0;
  processing = true;
  let completed = 0;
  try {
    const pending = Store.pendingFlashes(limit) as Array<{
      id: string;
      text: string;
      mode?: string | null;
    }>;
    for (const flash of pending) {
      Store.setFlashStatus(flash.id, 'analyzing');
      try {
        const analysis = await Llm.capture(flash.text, flash.mode || undefined);
        Store.completeFlash(flash.id, analysis);
        completed += 1;
      } catch (error) {
        const message = Llm.userMessage(error);
        Store.setFlashStatus(flash.id, 'failed', message);
        if (
          error instanceof Llm.LlmError
          && ['auth', 'model', 'network', 'daily_limit'].includes(error.kind)
        ) {
          break;
        }
      }
    }
    return completed;
  } finally {
    processing = false;
  }
}
