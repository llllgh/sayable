import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import { esc, $ } from './ui.js';

/** Frozen context, hint flag and self assessment survive navigation and restart. */
export function recognitionCard(item, { sourceId = 'review', onDone = () => {}, onSkip } = {}) {
  const id = `recognition-${item.id}`;
  let session = S.activeRecognitionSession(item.id, sourceId);
  let preparing = false;
  const revision = item.goalRevision || 0;
  const html = `<section class="card stack recognition-card" id="${id}">
    <span class="eyebrow">理解用法 · 看懂即可</span>
    <p class="skel en">${esc(item.lemma || item.skeleton)}</p>
    ${!item.recognition?.startedAt ? `<details><summary>原文用法</summary>
      <p class="quote en">${esc(item.source.raw)}</p><p class="zh">${esc(item.sense || item.zh)}</p>
      <p class="zh">${esc(item.vocabularyMaterial?.usage || '')}</p></details>` : ''}
    <div data-recognition-content></div>
    ${onSkip ? '<button class="btn-text" data-skip>稍后</button>' : ''}
  </section>`;
  function render(root) {
    const content = $('[data-recognition-content]', root);
    if (!session) {
      content.innerHTML = `<p class="zh dim">在另一句语境里，试着理解这个词。</p>
        <button class="btn btn-pri btn-blk" data-prepare ${preparing ? 'disabled' : ''}>${preparing ? '正在准备…' : '开始语境检查'}</button>
        <p class="tiny zh" data-error></p>`;
      $('[data-prepare]', root).onclick = async () => {
        if (preparing) return;
        preparing = true; render(root);
        try {
          const material = !item.recognition?.startedAt && item.vocabularyMaterial
            ? item.vocabularyMaterial
            : await L.prepareVocabularyMaterial({
              ...item, anchorSentence: [...S.state.recognitionSessions].reverse()
                .find(entry => entry.itemId === item.id)?.sentence || item.anchorSentence,
            }, { review: true });
          if ((S.getItem(item.id)?.goalRevision || 0) !== revision || item.learningGoal !== 'recognition') return;
          session = S.beginRecognitionSession(item.id, sourceId, material);
          if (root.isConnected) render(root);
        } catch (error) {
          if (root.isConnected) {
            preparing = false; render(root);
            $('[data-error]', root).textContent = L.userMessage(error);
          }
        } finally { preparing = false; }
      };
      return;
    }
    content.innerHTML = `<div class="stack">
      <p class="tiny zh">新语境 · 学习示例</p>
      <p class="quote en">${esc(session.sentence)}</p>
      <button class="btn-text" data-say>朗读</button>
      ${session.settledAt ? `<p class="zh">${session.result === 'unfamiliar' ? '用法还不熟，明天再巩固。' : item.status === 'familiar' ? '已熟悉，退出日常复习。' : session.hinted ? '记下了提示后理解，明天再独立检查。' : '已记录理解自评，按计划再巩固。'}</p>
        <p class="zh">${esc(session.explanation)}</p>
        <button class="btn btn-pri btn-blk" data-next>完成这一条</button>` : `
      <label class="fld"><span>你理解的意思（选填）</span><textarea data-answer rows="2" placeholder="用自己的话解释这句的意思">${esc(session.answerDraft)}</textarea></label>
      <button class="btn-text" data-hint>查看解释</button>
      <p class="zh" data-explanation ${session.hinted ? '' : 'hidden'}>${esc(session.explanation)}</p>
      <p class="tiny zh">理解自评，不计为主动输出。</p>
      <div class="row"><button class="btn btn-pri grow" data-understood>看懂了</button><button class="btn btn-ghost" data-unfamiliar>还不熟</button></div>`}
    </div>`;
    $('[data-say]', root).onclick = () => SP.say(session.sentence);
    $('[data-answer]', root)?.addEventListener('input', event => { session.answerDraft = event.target.value; S.save(); });
    $('[data-hint]', root)?.addEventListener('click', () => {
      S.hintRecognition(session.id);
      $('[data-explanation]', root).hidden = false;
    });
    for (const result of ['understood', 'unfamiliar']) {
      $(`[data-${result}]`, root)?.addEventListener('click', async () => {
        S.settleRecognition(session.id, result, session.answerDraft);
        await S.flush(); if (root.isConnected) render(root);
      });
    }
    $('[data-next]', root)?.addEventListener('click', () => {
      S.completeRecognitionSession(session.id);
      S.completeVocabularyItemEverywhere(item.id);
      onDone();
    });
  }
  return { html, mount() {
    const root = document.getElementById(id);
    if (root) { render(root); $('[data-skip]', root)?.addEventListener('click', onSkip); }
  } };
}
