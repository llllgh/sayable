/* =========================================================================
   views.js — 今天 / 召回 / 收编
   ========================================================================= */
import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import { esc, skel, $, $$, toast, openSheet, closeSheet, ago, inWords, words, ladderHTML, srcPill, thinking } from './ui.js';
import { buildJudgementFeedback } from '../src/core/judgement.ts';
import { recommendationProgress } from '../src/core/recommendations.ts';
import { reviewSupport } from '../src/core/review-support.ts';
import {
  buildReviewCue,
  hasSpecificReviewCue,
} from '../src/core/review-cue.ts';
import { canStartRoleplay } from './roleplay.js';
import {
  chooseTodayMode,
  createReviewGroup,
} from '../src/core/today.ts';

export let go = () => {};                 // 由 main.js 注入路由
export function bindRouter(fn) { go = fn; }

/* ---------------------------------------------------------------- 通用：造句题的本地出题 */
/* 前几档给「接近翻译」的具体中文（模型在捕获时写好的 target_zh），
   让提示真正有指向；后几档用模型写的具体情景任务。全程只用中文，
   不把中文模板套在英文画像字段上，避免「与Foreign colleagues沟通…」这类夹杂。 */
export function cueFor(it) {
  return buildReviewCue(it);
}

async function regenerateCueForItem(item) {
  const drill = await L.regenerateReviewCue(item);
  S.setItemDrill(item.id, drill);
  return cueFor(item);
}

function diffSegmentsHTML(segments, kind) {
  const tag = kind === 'before' ? 'del' : 'ins';
  return segments.map(segment => (
    segment.changed
      ? `<${tag} class="judgement-diff-change">${esc(segment.value)}</${tag}>`
      : esc(segment.value)
  )).join('');
}

function judgementDiffHTML(diff, title) {
  if (!diff) return '';
  return `<section class="judgement-diff" aria-label="${esc(title)}">
    <div class="judgement-diff-title">${esc(title)}</div>
    <div class="judgement-diff-row">
      <span>你的表达</span>
      <p class="en">${diffSegmentsHTML(diff.before, 'before')}</p>
    </div>
    <div class="judgement-diff-row">
      <span>建议表达</span>
      <p class="en">${diffSegmentsHTML(diff.after, 'after')}</p>
    </div>
    <p class="judgement-diff-summary zh">${esc(diff.summary)}</p>
  </section>`;
}

/* ---------------------------------------------------------------- 召回卡（核心组件） */
/* 前三档提供英文骨架和例句，后三档撤掉英文提示。
   答错退阶后会重新获得提示，避免把复习变成持续受挫。 */
export function drillCard(it, cue, opts = {}) {
  const t0 = Date.now();
  const id = 'd' + it.id;
  const support = reviewSupport(it);
  const isTerm = it.kind === 'term';
  let referenceAnswer = opts.referenceAnswer || it.drill?.answer || support.example;
  const guided = support.mode === 'guided';
  const needsSpecificCue = !hasSpecificReviewCue(it);
  const session = S.ensurePracticeSession(it.id, {
    source: opts.sessionSource || 'practice',
    sourceId: opts.sessionSourceId || it.id,
    cue,
    answer: opts.initialAnswer || '',
  });
  let activeCue = {
    brief: session.cue.brief || cue.brief || '',
    ctx: session.cue.context || cue.ctx || '',
    target_zh: session.cue.targetZh || cue.target_zh || '',
    trigger: session.cue.trigger || cue.trigger || '',
  };
  const html = `
  <div class="card drill-card${opts.compact ? ' is-collapsed' : ''}" id="${id}">
    <div class="row drill-head" style="justify-content:space-between">
      <span class="eyebrow">${esc(opts.label || '练习')}</span>
      <span class="tiny zh">${opts.remaining ? `${opts.remaining} 条待复习` : guided ? '含英文提示' : '主动回忆'}</span>
    </div>
    <div class="drill-input">
      <p class="zh drill-cue" id="${id}-cue">${esc(activeCue.brief)}</p>
      <p class="tiny zh drill-trigger" id="${id}-trigger" ${activeCue.trigger ? '' : 'hidden'}>触发时机：${esc(activeCue.trigger)}</p>
      ${opts.compact ? `<button class="btn btn-pri btn-blk drill-expand" id="${id}-expand" aria-expanded="false" aria-controls="${id}-answer">说一句试试 <svg viewBox="0 0 24 24" class="ic" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button>` : ''}
      <div id="${id}-answer" ${opts.compact ? 'hidden' : ''}>
      ${needsSpecificCue || guided ? `<button class="btn-text" id="${id}-regen-cue" type="button">${needsSpecificCue ? '生成更具体的提示' : '换一个练习场景'}</button>` : ''}
      ${guided ? `<div class="drill-guide">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="grow">
            <span class="eyebrow">${isTerm ? '目标词汇与搭配' : '目标表达'}</span>
            <p class="skel en">${skel(support.skeleton)}</p>
          </div>
          <button class="icon-button" id="${id}-guide-play" aria-label="朗读目标表达" title="朗读目标表达">
            <svg viewBox="0 0 24 24" class="ic"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12"/></svg>
          </button>
        </div>
        ${support.example ? `<div class="drill-example"><span class="eyebrow">参考句</span><p class="en">${esc(support.example)}</p></div>` : ''}
      </div>` : ''}
      <p class="dim zh drill-instruction">${guided
        ? isTerm
          ? '参考词汇和搭配，在当前工作场景中完整说一句。'
          : '参考上面的表达，完整说出一句即可。'
        : isTerm
          ? '现在不显示目标词汇，按中文场景完整说一句。'
          : '现在不显示英文提示，按中文场景完整说一句。'}</p>
      <div class="answer-compose">
        <textarea id="${id}-a" rows="3" aria-label="你的英文表达" placeholder="说出或输入英文句子">${esc(session.answerDraft)}</textarea>
        <button class="mic" id="${id}-mic" aria-label="开始录音" title="开始录音">
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="drill-actions ${opts.skippable ? 'has-skip' : ''}">
        <button class="btn btn-pri" id="${id}-go">提交答案</button>
        <button class="btn btn-ghost" id="${id}-reveal">${guided ? '还不会' : '查看答案'}</button>
        ${opts.skippable ? `<button class="btn-text" id="${id}-skip">稍后</button>` : ''}
      </div>
      </div>
    </div>
    <div id="${id}-out"></div>
  </div>`;

  function mount() {
    const root = $('#' + id); if (!root) return;
    const ta = $('#' + id + '-a'), out = $('#' + id + '-out');
    let recording = false;
    let inputMode = 'unknown';
    let rawTranscript = '';
    let hadVoiceInput = false;
    let done = Boolean(session.completedAt);
    const micButton = $('#' + id + '-mic');
    const submitButton = $('#' + id + '-go');
    const revealButton = $('#' + id + '-reveal');
    const guide = root.querySelector('.drill-guide');
    const instruction = root.querySelector('.drill-instruction');
    $('#' + id + '-expand')?.addEventListener('click', event => {
      $('#' + id + '-answer').hidden = false;
      event.currentTarget.setAttribute('aria-expanded', 'true');
      event.currentTarget.hidden = true;
      root.classList.remove('is-collapsed');
      ta.focus({ preventScroll: true });
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const stopRecording = () => {
      recording = false;
      micButton?.classList.remove('rec');
      micButton?.setAttribute('aria-label', '开始录音');
      SP.stop();
    };
    const lockInput = (stateClass) => {
      stopRecording();
      ta.blur();
      root.classList.add(stateClass);
      if (micButton) micButton.disabled = true;
      if (submitButton) submitButton.disabled = true;
      if (revealButton) revealButton.disabled = true;
      ta.readOnly = true;
      requestAnimationFrame(() => {
        if (root.isConnected) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    const unlockInput = () => {
      root.classList.remove('is-submitting');
      if (micButton) micButton.disabled = false;
      if (submitButton) submitButton.disabled = false;
      if (revealButton) revealButton.disabled = false;
      ta.readOnly = false;
    };
    const complete = (ok, usedReal = false) => {
      S.completePracticeSession(session.id);
      opts.onGraded?.(ok, usedReal);
    };
    const enterRetryUI = () => {
      const retrySession = S.startPracticeRetry(session.id);
      if (!retrySession) {
        toast('这道题已完成两次重答，先稍后再练');
        return;
      }
      done = false;
      stopRecording();
      root.classList.remove('is-complete', 'is-submitting');
      if (guide) guide.hidden = true;
      if (instruction) {
        instruction.textContent = '先不看参考，用自己的话再说一次。';
      }
      ta.readOnly = false;
      ta.value = retrySession.answerDraft;
      rawTranscript = '';
      hadVoiceInput = false;
      inputMode = 'unknown';
      if (micButton) micButton.disabled = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = '检查这次';
      }
      if (revealButton) {
        revealButton.disabled = false;
        revealButton.textContent = '再看提示';
      }
      out.innerHTML = '';
      ta.focus({ preventScroll: true });
      ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const renderReveal = () => {
      lockInput('is-complete');
      root.classList.remove('is-submitting');
      out.innerHTML = `<div class="drill-result">
        <div class="eyebrow" style="margin-bottom:6px">${isTerm ? '词汇与参考答案' : '参考答案'}</div>
        <p class="skel en">${skel(it.skeleton)}</p>
        ${referenceAnswer ? `<p class="en sub" style="margin-top:8px">${esc(referenceAnswer)}</p>` : ''}
        <p class="dim zh" style="margin-top:8px">${esc(it.why || '')}</p>
        <div class="drill-result-actions">
          <button class="btn btn-pri drill-action-primary" id="${id}-retry">我再说一次</button>
          <button class="btn btn-ghost drill-action-complete" id="${id}-again">稍后再练</button>
        </div>
      </div>`;
      $('#' + id + '-again')?.addEventListener('click', () => complete(false));
      $('#' + id + '-retry')?.addEventListener('click', enterRetryUI);
    };
    const renderFeedback = (ok, feedback, attempt) => {
      const isRetry = attempt?.kind === 'retry';
      const retriesUsed = session.attempts.filter(
        candidate => candidate.kind === 'retry' && candidate.status === 'judged',
      ).length;
      const canRetry = retriesUsed < 2;
      const feedbackLabel = feedback.kind === 'passed'
        ? feedback.languageKind === 'optional' ? '通过，可选优化' : '通过'
        : feedback.kind === 'passed_with_correction'
          ? '通过，但需纠正'
          : '再练一次';
      const feedbackClass = feedback.kind === 'passed'
        ? ''
        : feedback.kind === 'passed_with_correction'
          ? 'needs-correction'
          : 'needs-practice';
      const nxt = S.getItem(it.id);
      lockInput('is-complete');
      root.classList.remove('is-submitting');
      const retryPrimary = isRetry && ok
        ? '完成'
        : feedback.languageKind === 'optional'
          ? '练习这个版本'
          : feedback.kind === 'passed'
            ? '脱稿再说一次'
            : '我再说一次';
      const showRetryPrimary = isRetry && ok ? false : canRetry;
      out.innerHTML = `
      <div class="drill-result">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="drill-result-label ${feedbackClass}">${feedbackLabel}</span>
          ${ladderHTML(nxt.box, nxt.status === 'owned', { labeled: true })}
        </div>
        <p class="zh" style="font-weight:600">${esc(feedback.verdict)}</p>
        ${judgementDiffHTML(
          feedback.correction,
          feedback.kind === 'passed_with_correction'
            ? '需要纠正（不影响本次通过）'
            : '需要纠正',
        )}
        ${judgementDiffHTML(feedback.tighter, '可选精简')}
        ${feedback.note ? `<p class="judgement-note zh"><b>为什么：</b>${esc(feedback.note)}</p>` : ''}
        ${attempt?.revisionStatus === 'schedule_pending'
          ? '<p class="tiny zh" style="margin-top:9px">文字和新判定已保存；此后已有其它练习更新，复习安排暂不回滚。</p>'
          : attempt?.revised
            ? '<p class="tiny zh" style="margin-top:9px">本次按修订后的文字重新判定。</p>'
            : ''}
        <p class="skel en" style="margin-top:12px">${skel(it.skeleton)} <button class="link" id="${id}-play" style="margin-left:6px">朗读</button></p>
        <div class="drill-result-actions">
          ${showRetryPrimary ? `<button class="btn btn-pri drill-action-primary" id="${id}-retry">${retryPrimary}</button>` : `<button class="btn btn-pri drill-action-primary drill-action-wide" id="${id}-next">完成</button>`}
          ${showRetryPrimary ? `<button class="btn btn-ghost drill-action-complete" id="${id}-next">${ok ? '完成' : '稍后再练'}</button>` : ''}
          ${attempt?.inputMode === 'voice' && attempt.judgementSource === 'model'
            ? `<button class="btn btn-ghost drill-action-wide" id="${id}-revise">修改识别文字</button>`
            : ''}
          ${ok && !isRetry && canStartRoleplay(nxt) ? `<button class="btn btn-ghost" id="${id}-roleplay">情境对话</button>` : ''}
          <button class="btn btn-ghost ${ok && !isRetry && canStartRoleplay(nxt) ? '' : 'drill-action-wide'}" id="${id}-used">记录实际使用</button>
        </div>
        <p class="tiny zh" style="margin-top:8px">${isRetry
          ? ok ? '这次已经说清楚了；复习安排仍以首答为准。' : canRetry ? '首答形成的复习安排没有改变。' : '已完成两次重答，先保留结果，之后再独立练习。'
          : ok ? `下次复习：${inWords(nxt.dueAt)}` : '这条会在 8 小时后再次出现。'}</p>
      </div>`;
      $('#' + id + '-retry')?.addEventListener('click', enterRetryUI);
      $('#' + id + '-play')?.addEventListener('click', () => SP.say(it.skeleton));
      $('#' + id + '-used')?.addEventListener('click', () => {
        openSheet('在哪儿用的？', `<label class="fld"><span>真实场景（会议 / 邮件 / 客户名都行）</span>
          <input type="text" id="ur-sc" placeholder="${esc(S.state.profile.scenarios?.[0] || '填写使用场景')}" /></label>
          <button class="btn btn-pri btn-blk" id="ur-ok">记下来</button>
          <p class="tiny zh" style="margin-top:12px">这一栏只有你自己能填。它决定这条骨架能不能毕业，也是这个 app 唯一的北极星指标。</p>`, () => {
          $('#ur-ok').addEventListener('click', () => {
            S.markUsedReal(it.id, $('#ur-sc').value.trim() || activeCue.ctx);
            closeSheet();
            toast('已记入真实使用 ✓');
            complete(ok, true);
          });
        });
      });
      $('#' + id + '-next')?.addEventListener('click', () => complete(ok));
      $('#' + id + '-revise')?.addEventListener('click', () => {
        openSheet('修改本次识别文字', `<label class="fld"><span>确认后的英文</span>
          <textarea id="${id}-revision" rows="4">${esc(attempt.confirmedText || attempt.answer)}</textarea></label>
          <button class="btn btn-pri btn-blk" id="${id}-revision-save">重新检查</button>`, () => {
          $('#' + id + '-revision-save')?.addEventListener('click', async event => {
            const revisedAnswer = $('#' + id + '-revision')?.value.trim() || '';
            if (words(revisedAnswer) < 3) {
              toast('至少保留一个完整句子');
              return;
            }
            event.currentTarget.disabled = true;
            event.currentTarget.textContent = '正在检查…';
            try {
              const revised = await L.judge({
                skeleton: it.skeleton,
                zh: it.zh,
                brief: activeCue.brief,
                answer: revisedAnswer,
                seeds: it.seeds,
              });
              const revisedFeedback = buildJudgementFeedback(
                revisedAnswer,
                revised,
              );
              const revisedSession = S.revisePracticeAttempt(
                session.id,
                attempt.id,
                revisedAnswer,
                Boolean(revised.ok),
                {
                  judgement: revised,
                  feedback: revisedFeedback,
                  ctx: activeCue.ctx,
                  why: revisedFeedback.note
                    || revisedFeedback.correction?.summary
                    || '',
                },
              );
              closeSheet();
              if (!root.isConnected) return;
              const revisedAttempt = revisedSession?.attempts.find(
                candidate => candidate.id === attempt.id,
              );
              renderFeedback(Boolean(revised.ok), revisedFeedback, revisedAttempt);
            } catch (error) {
              event.currentTarget.disabled = false;
              event.currentTarget.textContent = '重新检查';
              toast(L.userMessage(error));
            }
          });
        });
      });
      $('#' + id + '-roleplay')?.addEventListener('click', () => {
        S.completePracticeSession(session.id);
        go('roleplay', it.id);
      });
    };

    $('#' + id + '-skip')?.addEventListener('click', () => { stopRecording(); opts.onSkip?.(); });
    $('#' + id + '-guide-play')?.addEventListener(
      'click',
      () => SP.say(support.example || support.skeleton),
    );
    $('#' + id + '-regen-cue')?.addEventListener('click', async () => {
      const button = $('#' + id + '-regen-cue');
      button.disabled = true;
      button.textContent = '正在生成…';
      try {
        activeCue = await regenerateCueForItem(it);
        S.updatePracticeCue(session.id, activeCue);
        const cueText = $('#' + id + '-cue');
        if (cueText) cueText.textContent = activeCue.brief;
        referenceAnswer = it.drill?.answer || support.example;
        const triggerText = $('#' + id + '-trigger');
        if (triggerText) {
          triggerText.textContent = `触发时机：${activeCue.trigger}`;
          triggerText.hidden = !activeCue.trigger;
        }
        button.disabled = false;
        button.textContent = '换一个练习场景';
        toast('新的练习场景已保存');
      } catch (error) {
        button.disabled = false;
        button.textContent = needsSpecificCue ? '重试生成具体提示' : '重试换一个场景';
        toast(L.userMessage(error));
      }
    });

    $('#' + id + '-mic')?.addEventListener('click', () => {
      if (!SP.canListen()) {
        ta.focus();
        toast('请使用系统键盘上的语音输入');
        return;
      }
      if (recording) { stopRecording(); return; }
      recording = true;
      micButton.classList.add('rec');
      micButton.setAttribute('aria-label', '停止录音');
      SP.listen({
        lang: 'en-US',
        onText: (t, finalText) => {
          hadVoiceInput = true;
          inputMode = 'voice';
          if (finalText) rawTranscript = finalText;
          else if (!rawTranscript) rawTranscript = t;
          ta.value = t;
          S.updatePracticeDraft(session.id, t);
        },
        onEnd: stopRecording,
        onError: e => { stopRecording(); toast(e.message); },
      });
    });
    ta.addEventListener('input', () => {
      inputMode = hadVoiceInput ? 'voice' : 'text';
      S.updatePracticeDraft(session.id, ta.value);
    });

    $('#' + id + '-reveal')?.addEventListener('click', () => {
      if (done) return;
      if (session.settlement) {
        S.markPracticePromptUsed(session.id);
        if (guide) guide.hidden = false;
        revealButton.disabled = true;
        revealButton.textContent = '已查看提示';
        return;
      }
      const attempt = S.beginPracticeAttempt(session.id, {
        answer: ta.value,
        inputMode,
        kind: 'reveal',
        promptUsed: guided,
      });
      if (!attempt) return;
      S.settlePracticeAttempt(session.id, attempt.id, false, {
        ms: Date.now() - t0,
        ctx: activeCue.ctx,
        why: 'revealed',
      });
      if (!root.isConnected) return;
      renderReveal();
      opts.onResult?.(false);
      SP.say(referenceAnswer || it.skeleton);
    });

    $('#' + id + '-go')?.addEventListener('click', async () => {
      const ans = ta.value.trim();
      if (words(ans) < 3) { toast('至少说一个完整的句子'); return; }
      S.updatePracticeDraft(session.id, ans);
      const attempt = S.beginPracticeAttempt(session.id, {
        answer: ans,
        inputMode: inputMode === 'unknown' ? 'text' : inputMode,
        rawTranscript,
        promptUsed: guided && !$('#' + id + '-answer')?.hidden,
      });
      if (!attempt) return;
      lockInput('is-submitting');
      out.innerHTML = thinking('正在检查表达');
      let r;
      try {
        r = await L.judge({
          kind: it.kind,
          skeleton: it.skeleton,
          zh: it.zh,
          brief: activeCue.brief,
          answer: ans,
          seeds: it.seeds,
        });
      } catch (e) {
        S.failPracticeAttempt(session.id, attempt.id, L.userMessage(e));
        if (!root.isConnected) return;
        unlockInput();
        out.innerHTML = `<div class="drill-result"><p class="zh sub">${esc(L.userMessage(e))}</p>
          <p class="tiny zh" style="margin-top:7px">可先记录自己的判断：</p>
          <div class="row wrap" style="margin-top:8px"><button class="btn btn-sm grow" id="${id}-self-ok">我说对了</button><button class="btn btn-sm btn-ghost" id="${id}-self-close">差一点</button><button class="btn btn-sm btn-ghost" id="${id}-self-no">没说出来</button></div></div>`;
        $('#' + id + '-self-ok')?.addEventListener('click', () => finish(true, { verdict: '你自己判为通过' }, ans, attempt.id, 'self'));
        $('#' + id + '-self-close')?.addEventListener('click', () => finish(false, { verdict: '差一点，8 小时后再来', note: '离线自评：差一点' }, ans, attempt.id, 'self'));
        $('#' + id + '-self-no')?.addEventListener('click', () => finish(false, { verdict: '你自己判为没过' }, ans, attempt.id, 'self'));
        return;
      }
      finish(!!r.ok, r, ans, attempt.id);
    });

    function finish(ok, r, ans, attemptId, judgementSource = 'model') {
      const feedback = buildJudgementFeedback(ans, { ...r, ok });
      const settled = S.settlePracticeAttempt(session.id, attemptId, ok, {
        ms: Date.now() - t0,
        ctx: activeCue.ctx,
        why: feedback.note || feedback.correction?.summary || '',
        judgement: { ...r, ok },
        feedback,
        judgementSource,
      });
      const settledAttempt = settled.attempts.find(
        candidate => candidate.id === attemptId && candidate.status === 'judged',
      );
      if (!settledAttempt || !root.isConnected) return;
      if (settledAttempt.kind === 'initial') opts.onResult?.(ok);
      renderFeedback(ok, feedback, settledAttempt);
    }

    if (session.settlement && session.phase === 'answering') {
      enterRetryUI();
    } else if (session.settlement) {
      const attempt = [...session.attempts]
        .reverse()
        .find(candidate => candidate.status === 'judged');
      if (attempt?.kind === 'reveal') {
        renderReveal();
      } else {
        const feedback = attempt?.feedback
          || buildJudgementFeedback(attempt?.answer || session.answerDraft, {
            ...(attempt?.judgement || {}),
            ok: attempt?.kind === 'retry'
              ? Boolean(attempt?.judgement?.ok)
              : session.settlement.passed,
          });
        renderFeedback(
          attempt?.kind === 'retry'
            ? Boolean(attempt?.judgement?.ok)
            : session.settlement.passed,
          feedback,
          attempt,
        );
      }
    } else if (session.phase === 'submitting') {
      lockInput('is-submitting');
      out.innerHTML = thinking('正在检查表达');
    } else {
      const lastError = [...session.attempts]
        .reverse()
        .find(attempt => attempt.status === 'error' && attempt.error);
      if (lastError) {
        out.innerHTML = `<p class="tiny zh" style="margin-top:8px">${esc(lastError.error)}</p>`;
      }
    }
  }
  return { html, mount };
}

/* ---------------------------------------------------------------- 今天与全局速记 */
let todayMode = null;
let reviewGroup = null;

export function setTodayMode(mode) {
  todayMode = mode === 'recommendation' ? 'recommendation' : 'review';
}

function recommendationModeLabel(progress) {
  if (!progress) return '今日推荐';
  return `已练 ${progress.completed}/${progress.total}`;
}

export function todayModeHTML(activeMode) {
  const dueCount = S.dueItems().length;
  const deck = S.todayRecommendationDeck();
  const progress = deck ? recommendationProgress(deck) : null;
  return `<div class="today-modes" role="tablist" aria-label="今天的练习模式">
    <button type="button" role="tab" data-today-mode="review" aria-selected="${activeMode === 'review'}" class="${activeMode === 'review' ? 'on' : ''}">
      <strong>复习</strong><span>${dueCount ? `待复习 ${dueCount} 条` : S.state.items.length ? '暂无到期' : '暂无复习'}</span>
    </button>
    <button type="button" role="tab" data-today-mode="recommendation" aria-selected="${activeMode === 'recommendation'}" class="${activeMode === 'recommendation' ? 'on' : ''}">
      <strong>今日推荐</strong><span>${recommendationModeLabel(progress)}</span>
    </button>
  </div>`;
}

export function bindTodayModeControls(root) {
  $$('[data-today-mode]', root).forEach(button => {
    button.addEventListener('click', () => {
      const mode = button.dataset.todayMode;
      setTodayMode(mode);
      go(mode === 'recommendation' ? 'recommend' : 'home');
    });
  });
}

export function openQuickCapture(onChange = () => {}) {
  const initialDraft = S.getDraft('quickCapture');
  let recording = false;
  const stopRecording = () => {
    recording = false;
    SP.stop();
  };
  document.body.classList.add('capture-open');
  const opened = openSheet(
    '记一句',
    `<p class="sub zh quick-capture-help">记下想说的意思，或刚听到的表达。</p>
    <div class="quick-capture-panel">
      <div class="quick-capture-input">
        <textarea id="quick-capture-text" rows="5" aria-label="记录内容" placeholder="输入中文意思或英文表达">${esc(initialDraft)}</textarea>
        <button class="mic" id="quick-capture-mic" type="button" aria-label="开始录音" title="开始录音">
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <p class="tiny zh quick-capture-status" id="quick-capture-status" aria-live="polite">${initialDraft ? '草稿已保存在本机' : '输入会自动保存为草稿'}</p>
      <div class="quick-capture-panel-actions">
        <button class="btn btn-pri grow" id="quick-capture-save" type="button">存好</button>
        <button class="btn btn-ghost" id="quick-capture-hide" type="button">收起</button>
      </div>
      ${initialDraft ? '<button class="btn-text quick-capture-new" id="quick-capture-new" type="button">另记一句</button>' : ''}
    </div>`,
    body => {
      const input = $('#quick-capture-text', body);
      const mic = $('#quick-capture-mic', body);
      const save = $('#quick-capture-save', body);
      const status = $('#quick-capture-status', body);
      const updateDraft = () => {
        S.setDraft('quickCapture', input.value);
        status.textContent = input.value.trim()
          ? '草稿已保存在本机'
          : '输入会自动保存为草稿';
        onChange();
      };
      const persist = async (keepOpen = false) => {
        const text = input.value.trim();
        if (!text) {
          if (!keepOpen) closeSheet();
          return;
        }
        stopRecording();
        save.disabled = true;
        const newButton = $('#quick-capture-new', body);
        if (newButton) newButton.disabled = true;
        status.textContent = '正在保存…';
        try {
          await S.saveQuickCapture(text);
          input.value = '';
          status.textContent = '已存到记录';
          onChange();
          if (keepOpen) {
            save.disabled = false;
            if (newButton) newButton.hidden = true;
            input.focus();
          } else {
            closeSheet();
            toast('已存到记录');
          }
        } catch {
          save.disabled = false;
          if (newButton) newButton.disabled = false;
          status.textContent = '保存失败，草稿仍在本机';
          toast('保存失败，请重试');
        }
      };
      input.addEventListener('input', updateDraft);
      mic.addEventListener('click', () => {
        if (!SP.canListen()) {
          input.focus();
          toast('请使用系统键盘上的语音输入');
          return;
        }
        if (recording) {
          stopRecording();
          mic.classList.remove('rec');
          mic.setAttribute('aria-label', '开始录音');
          return;
        }
        recording = true;
        mic.classList.add('rec');
        mic.setAttribute('aria-label', '停止录音');
        SP.listen({
          lang: /[a-zA-Z]/.test(input.value) && !/[\u4e00-\u9fa5]/.test(input.value) ? 'en-US' : 'zh-CN',
          onText: text => {
            if (!recording) return;
            input.value = text;
            updateDraft();
          },
          onEnd: () => {
            recording = false;
            mic.classList.remove('rec');
            mic.setAttribute('aria-label', '开始录音');
          },
          onError: error => {
            recording = false;
            mic.classList.remove('rec');
            mic.setAttribute('aria-label', '开始录音');
            toast(error.message);
          },
        });
      });
      save.addEventListener('click', () => persist(false));
      $('#quick-capture-hide', body).addEventListener('click', () => closeSheet());
      $('#quick-capture-new', body)?.addEventListener('click', () => persist(true));
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    },
    {
      onClose: () => {
        stopRecording();
        document.body.classList.remove('capture-open');
        onChange();
      },
    },
  );
  if (!opened) document.body.classList.remove('capture-open');
}

function reviewCompletionHTML(dueCount, recommendationProgressState, paused) {
  if (paused) {
    return `<section class="today-finish" role="status">
      <span class="today-finish-mark" aria-hidden="true">✓</span>
      <h2>今天先到这里</h2>
      <p>${dueCount ? `${dueCount} 条仍会保留在复习队列。` : '本次进度已经保存。'}</p>
      ${dueCount ? '<button class="btn btn-ghost" id="review-resume">继续复习</button>' : ''}
    </section>`;
  }
  if (dueCount) {
    return `<section class="today-finish" role="status">
      <span class="today-finish-mark" aria-hidden="true">✓</span>
      <h2>这组练完了，还有 ${dueCount} 条</h2>
      <p>剩余内容不会被标记完成。</p>
      <div class="today-finish-actions">
        <button class="btn btn-pri" id="review-stop">先到这里</button>
        <button class="btn btn-ghost" id="review-more">再练一组</button>
      </div>
    </section>`;
  }
  if (!recommendationProgressState || recommendationProgressState.remaining) {
    return `<section class="today-finish" role="status">
      <span class="today-finish-mark" aria-hidden="true">✓</span>
      <h2>这组复习完成了</h2>
      <p>可以继续今天的推荐，也可以先结束。</p>
      <div class="today-finish-actions">
        <button class="btn btn-pri" data-today-mode="recommendation">去今日推荐</button>
        <button class="btn btn-ghost" id="review-stop">先到这里</button>
      </div>
    </section>`;
  }
  return `<section class="today-finish is-all-done" role="status">
    <span class="today-finish-mark" aria-hidden="true">✓</span>
    <h2>今天的练习完成了</h2>
    <p>复习与今日推荐都已完成。</p>
  </section>`;
}

export function viewHome(app) {
  const due = S.dueItems();
  const activeSession = S.latestPracticeSession(['due-review', 'recommendation']);
  const deck = S.todayRecommendationDeck();
  const recommendationState = deck ? recommendationProgress(deck) : null;
  const selected = chooseTodayMode({
    selectedMode: todayMode,
    activeSource: activeSession?.source,
    dueCount: due.length,
    recommendationRemaining: recommendationState?.remaining ?? null,
  });
  if (selected === 'recommendation') {
    todayMode = 'recommendation';
    app.innerHTML = '<div class="view"></div>';
    queueMicrotask(() => go('recommend'));
    return;
  }
  todayMode = 'review';

  const resumedReview = activeSession?.source === 'due-review'
    ? activeSession
    : S.latestPracticeSession('due-review');
  if (!reviewGroup && (due.length || resumedReview)) {
    reviewGroup = {
      ids: createReviewGroup(
        due.map(item => item.id),
        resumedReview?.itemId || '',
      ),
      index: 0,
      paused: false,
    };
  }
  while (reviewGroup && reviewGroup.index < reviewGroup.ids.length
    && !S.getItem(reviewGroup.ids[reviewGroup.index])) {
    reviewGroup.index += 1;
  }
  const itemId = reviewGroup?.ids[reviewGroup.index] || '';
  const item = itemId ? S.getItem(itemId) : null;
  const groupComplete = Boolean(reviewGroup && reviewGroup.index >= reviewGroup.ids.length);

  app.innerHTML = `<div class="view stack home-view">
    <div class="page-head">
      <div class="page-head-copy"><h1 class="h-lg zh">今天</h1></div>
    </div>
    ${todayModeHTML('review')}
    ${item && !reviewGroup.paused ? `<div class="today-group-progress">
      <span>本组 ${reviewGroup.index + 1} / ${reviewGroup.ids.length}</span>
      <span>${due.length} 条待复习</span>
    </div><div id="hero"></div>` : reviewGroup?.paused || groupComplete
      ? reviewCompletionHTML(due.length, recommendationState, reviewGroup?.paused)
      : `<section class="today-finish ${recommendationState && !recommendationState.remaining ? 'is-all-done' : ''}" role="status">
          <span class="today-finish-mark" aria-hidden="true">✓</span>
          <h2>${recommendationState && !recommendationState.remaining ? '今天的练习完成了' : '现在没有到期复习'}</h2>
          <p>${S.state.items.length ? '练过的表达会按计划回到这里。' : '练过的表达会在这里安排复习。'}</p>
          ${!recommendationState || recommendationState.remaining ? '<button class="btn btn-pri" data-today-mode="recommendation">去今日推荐</button>' : ''}
        </section>`}
  </div>`;

  bindTodayModeControls(app);
  $('#review-stop', app)?.addEventListener('click', () => {
    if (!reviewGroup) reviewGroup = { ids: [], index: 0, paused: true };
    reviewGroup.paused = true;
    viewHome(app);
  });
  $('#review-more', app)?.addEventListener('click', () => {
    reviewGroup = null;
    viewHome(app);
  });
  $('#review-resume', app)?.addEventListener('click', () => {
    reviewGroup = null;
    viewHome(app);
  });

  if (item && !reviewGroup.paused) {
    const session = S.activePracticeSession(item.id, 'due-review', item.id);
    const drill = drillCard(item, cueFor(item), {
      label: `复习 · 本组 ${reviewGroup.index + 1}/${reviewGroup.ids.length}`,
      remaining: due.length,
      skippable: true,
      sessionSource: session?.source || 'due-review',
      sessionSourceId: session?.sourceId || item.id,
      onSkip: () => {
        reviewGroup.index += 1;
        viewHome(app);
      },
      onGraded: () => {
        reviewGroup.index += 1;
        viewHome(app);
        ($('#hero', app) || $('.today-finish', app))?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      },
    });
    $('#hero', app).innerHTML = drill.html;
    drill.mount();
  }
}

/* ---------------------------------------------------------------- 收编 */
const MODE_LABEL = { zh: '中文意思', mine: '我写的英文', heard: '听到的表达', fragment: '只记得半句' };

let pendingFlashId = null;
export function viewCapture(app, arg) {
  let prefill = '';
  let cachedAnalysis = null;
  let pendingStatus = 'raw';
  pendingFlashId = null;
  if (typeof arg === 'string') prefill = arg;
  else if (arg && arg.flashId) {
    const f = S.getFlash(arg.flashId);
    if (f) {
      prefill = f.text;
      pendingFlashId = f.id;
      cachedAnalysis = f.analysis || null;
      pendingStatus = f.status || 'raw';
    }
  }
  else if (arg && arg.text) prefill = arg.text;
  if (!prefill) prefill = S.getDraft('expression');
  app.innerHTML = `<div class="view stack">
    <div class="page-head">
      <div class="page-head-copy">
        <h1 class="h-lg zh">${pendingFlashId ? '整理记录' : '添加表达'}</h1>
        <p class="sub zh">${pendingFlashId ? '处理之前保存的一条记录。' : '输入中文意思或英文原句。'}</p>
      </div>
      ${pendingFlashId ? '<button class="btn btn-sm btn-ghost" id="capture-back">返回记录</button>' : ''}
    </div>
    <div class="card" id="capture-input">
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="cap" rows="5" placeholder="例如：我想礼貌地提醒对方尽快确认" ${pendingStatus === 'analyzing' ? 'readonly' : ''}>${esc(prefill)}</textarea>
        <button class="mic" id="cap-mic" aria-label="开始录音" title="开始录音" ${pendingStatus === 'analyzing' ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:11px">
        <span class="chip" id="cap-mode">自动识别</span>
        <button class="link mute" id="cap-force" ${pendingStatus === 'analyzing' ? 'disabled' : ''}>指定输入类型</button>
      </div>
      <button class="btn btn-pri btn-blk" id="cap-go" style="margin-top:13px" ${pendingStatus === 'analyzing' ? 'disabled' : ''}>${pendingStatus === 'analyzing' ? '正在整理…' : '生成表达'}</button>
    </div>
    <div id="cap-out"></div>
  </div>`;

  const ta = $('#cap');
  const chip = $('#cap-mode');
  const micButton = $('#cap-mic');
  const analyzeButton = $('#cap-go');
  let forced = null, recording = false;
  const stopCaptureRecording = () => {
    recording = false;
    micButton.classList.remove('rec');
    micButton.setAttribute('aria-label', '开始录音');
    SP.stop();
  };
  const refresh = () => { const m = forced || L.detectMode(ta.value); chip.textContent = ta.value.trim() ? MODE_LABEL[m] : '自动识别'; chip.className = 'chip ' + (ta.value.trim() ? 'acc' : ''); };
  ta.addEventListener('input', () => {
    refresh();
    if (pendingFlashId) S.updateFlashText(pendingFlashId, ta.value);
    else S.setDraft('expression', ta.value);
  });
  refresh();
  if (prefill && pendingStatus !== 'analyzing') ta.focus();

  $('#cap-force').addEventListener('click', () => {
    openSheet('这段是什么？', Object.entries(MODE_LABEL).map(([k, v]) =>
      `<button class="btn btn-blk btn-ghost" style="margin-bottom:8px;justify-content:flex-start" data-m="${k}">${v}</button>`).join('')
      + `<p class="tiny zh">自动识别是为了省你一次点击，不是为了替你决定。`, (body) => {
        $$('[data-m]', body).forEach(b => b.addEventListener('click', () => { forced = b.dataset.m; refresh(); closeSheet(); }));
      });
  });

  micButton.addEventListener('click', () => {
    if (!SP.canListen()) {
      ta.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (recording) {
      stopCaptureRecording();
      return;
    }
    recording = true;
    micButton.classList.add('rec');
    micButton.setAttribute('aria-label', '停止录音');
    const zh = /[\u4e00-\u9fa5]/.test(ta.value) || !ta.value;
    SP.listen({
      lang: zh ? 'zh-CN' : 'en-US',
      onText: t => {
        if (!recording) return;
        ta.value = t;
        refresh();
        if (pendingFlashId) S.updateFlashText(pendingFlashId, t);
        else S.setDraft('expression', t);
      },
      onEnd: () => {
        recording = false;
        micButton.classList.remove('rec');
        micButton.setAttribute('aria-label', '开始录音');
      },
      onError: e => {
        recording = false;
        micButton.classList.remove('rec');
        micButton.setAttribute('aria-label', '开始录音');
        toast(e.message);
      },
    });
  });

  analyzeButton.addEventListener('click', async () => {
    stopCaptureRecording();
    const text = ta.value.trim();
    if (text.length < 4) { toast('先写点东西'); return; }
    const out = $('#cap-out');
    analyzeButton.disabled = true;
    micButton.disabled = true;
    ta.readOnly = true;
    out.innerHTML = thinking('正在生成自然表达');
    out.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (pendingFlashId) S.setFlashStatus(pendingFlashId, 'analyzing');
    try {
      const r = await L.capture(text, forced);
      if (pendingFlashId) S.completeFlash(pendingFlashId, r);
      renderCaptureResult(out, r, text, app);
    } catch (e) {
      if (pendingFlashId) S.setFlashStatus(pendingFlashId, 'failed', L.userMessage(e));
      out.innerHTML = `<div class="card rose"><p class="zh sub">${esc(L.userMessage(e))}</p>
        <p class="tiny zh" style="margin-top:8px">输入已保留在上面，可以直接重试。</p></div>`;
    } finally {
      analyzeButton.disabled = false;
      micButton.disabled = false;
      ta.readOnly = false;
    }
  });

  if (cachedAnalysis) {
    renderCaptureResult($('#cap-out'), cachedAnalysis, prefill, app);
  } else if (pendingStatus === 'analyzing') {
    $('#cap-out').innerHTML = thinking('正在后台整理，稍后回来查看');
  }
  $('#capture-back')?.addEventListener('click', () => {
    go('library', { section: 'records', restore: true });
  });
}

function renderCaptureResult(out, r, raw, app) {
  const pendingFlash = pendingFlashId ? S.getFlash(pendingFlashId) : null;
  const admission = r.admission || (r.primary?.skeleton ? 'new' : 'none');
  const reusedItem = admission === 'reuse' ? S.getItem(r.reuseItemId) : null;
  const p = admission === 'reuse' ? reusedItem : r.primary;
  const primaryExisting = p?.skeleton
    ? S.findItemBySkeleton(p.skeleton, p.kind)
    : null;
  const bonusExisting = r.bonus?.skeleton
    ? S.findItemBySkeleton(r.bonus.skeleton)
    : null;
  const risky = /risky/i.test(p?.native_check || '') || r.flagged;
  const feedbackKind = r.feedbackKind || (
    r.correction ? 'correct' : r.alternative ? 'optional' : 'keep'
  );
  const feedbackLabel = feedbackKind === 'correct'
    ? '需要修正'
    : feedbackKind === 'optional'
      ? '原句可用，可选优化'
      : '原句可直接使用';
  const left = S.weeklyTargetLeft();
  const delayDays = S.nextItemReviewDelayDays();
  const input = $('#capture-input');
  if (input) input.hidden = true;
  out.innerHTML = `<div class="stack">
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">生成结果</div>
        <p class="sub zh">${esc(r.read || '')}</p>
      </div>
      <button class="btn btn-sm btn-ghost" id="cap-edit">修改输入</button>
    </div>

    <div class="card ${feedbackKind === 'correct' ? 'rose' : 'acc'}">
      <div class="eyebrow" style="color:var(--acc)">${feedbackLabel}</div>
      <p class="en" style="font-size:16.5px;margin-top:7px;line-height:1.55">${esc(r.natural)}
        <button class="link" id="say-nat" style="margin-left:6px">朗读</button></p>
      ${r.mainIssue ? `<p class="zh" style="margin-top:10px;font-weight:600">${esc(r.mainIssue)}</p>` : ''}
      ${r.correction && r.correction !== r.natural ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">必要修正版</div>
        <p class="en" style="font-size:15.5px;margin-top:6px">${esc(r.correction)}</p></div>` : ''}
      ${r.alternative ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">可选版本</div>
        <p class="en" style="font-size:15.5px;margin-top:6px">${esc(r.alternative)}</p>
        <p class="tiny zh" style="margin-top:5px">原句没有错，不采用这个版本不会影响结果。</p></div>` : ''}
      ${r.spoken ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">精简口语版 · ${words(r.spoken)} 词</div>
        <p class="en" style="font-size:15.5px;margin-top:6px">${esc(r.spoken)} <button class="link" id="say-sp">朗读</button></p></div>` : ''}
    </div>

    ${r.diagnosis?.symptom ? `<details class="result-details">
      <summary>查看表达分析</summary>
      <div style="padding-bottom:10px">
      <p class="zh" style="margin-top:7px;font-weight:600">${esc(r.diagnosis.symptom)}</p>
      ${r.diagnosis.before ? `<div class="compare" style="margin-top:11px">
        <div class="before"><div class="wc" style="color:var(--rose)">原句 · ${words(r.diagnosis.before)} 词</div><p class="en strike" style="font-size:13.5px">${esc(r.diagnosis.before)}</p></div>
        <div class="after"><div class="wc" style="color:var(--acc)">建议 · ${words(r.diagnosis.after || '')} 词</div><p class="en" style="font-size:14px">${esc(r.diagnosis.after || '')}</p></div></div>` : ''}
      </div>
    </details>` : ''}

    ${p ? `<div class="sec"><span class="eyebrow">${admission === 'reuse' ? '关联已有内容' : p.kind === 'term' ? '专业词汇' : '核心句型'}</span><hr/></div>
    <div class="card acc">
      <p class="skel en">${skel(p.skeleton)} <button class="link" id="say-sk" style="margin-left:6px">朗读</button></p>
      <p class="zh" style="margin-top:5px;color:var(--fg-2);font-size:13.5px">${esc(p.zh)}</p>
      ${p.kind === 'term' && p.collocations?.length ? `<div style="margin-top:11px">
        <div class="eyebrow">常见搭配</div>
        <div class="chips" style="margin-top:7px">${p.collocations.map(value => `<span class="chip">${esc(value)}</span>`).join('')}</div>
      </div>` : ''}
      ${p.trigger ? `<p class="zh" style="margin-top:10px"><b>触发时机：</b>${esc(p.trigger)}</p>` : ''}
      <p class="zh" style="margin-top:10px;font-weight:600">${esc(p.why)}</p>
      <div class="chips" style="margin-top:11px">
        ${(p.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}
        <span class="chip ${risky ? 'warm' : 'acc'}">${risky ? '需要注意语境' : '自然表达'}</span>
        <span class="chip violet">${srcLabel(r.mode)}</span>
      </div>
      ${p.native_check ? `<p class="tiny zh" style="margin-top:9px">${esc(p.native_check)}</p>` : ''}
      <div style="margin-top:13px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">参考例句</div>
        <ul class="bul en" style="margin-top:7px">${(p.seeds || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
      ${p.trap ? `<p class="tiny zh" style="margin-top:10px;color:var(--warm)">注意：${esc(p.trap)}</p>` : ''}
    </div>` : ''}

    ${r.bonus?.skeleton ? `<details class="result-details"><summary>查看相关表达</summary>
      <div class="related-expression">
        <p class="skel en" style="font-size:16px">${skel(r.bonus.skeleton)}
          <button class="link" id="say-bonus" style="margin-left:6px">朗读</button></p>
        <p class="zh sub" style="margin-top:5px">${esc(r.bonus.zh || '')}</p>
        <p class="zh" style="margin-top:9px"><b>触发时机：</b>${esc(r.bonus.trigger || '')}</p>
        <p class="zh" style="margin-top:9px;font-size:13.5px">${esc(r.bonus.why || '')}</p>
        ${(r.bonus.seeds || []).length ? `<div style="margin-top:11px;padding-top:10px;border-top:1px solid var(--line)">
          <div class="eyebrow">参考例句</div>
          <ul class="bul en" style="margin-top:7px">${r.bonus.seeds.map(seed => `<li>${esc(seed)}</li>`).join('')}</ul>
        </div>` : ''}
        <button class="btn ${bonusExisting ? 'btn-ghost' : 'btn-pri'} btn-blk" id="cap-add-bonus" style="margin-top:12px">
          ${bonusExisting ? '已在表达库，开始练习' : '加入并开始练习'}
        </button>
        <div id="cap-bonus-drill"></div>
      </div>
    </details>` : ''}

    ${pendingFlash && p ? `<div class="record-resolution">
      <p class="tiny zh">${pendingFlash.status === 'handled' ? '这条记录已处理，可继续关联其它表达。' : '结果只供查看，由你决定是否加入表达库。'}</p>
      <button class="btn btn-ghost btn-blk" id="cap-keep-original" type="button" ${pendingFlash.status === 'handled' ? 'disabled' : ''}>${pendingFlash.status === 'handled' ? '已处理' : '保留原句并完成'}</button>
    </div>` : ''}

    ${p ? `<div class="card">
      <p class="zh" style="font-weight:600">${p.kind === 'term' ? '加入词汇并练习' : '加入表达库并练习'}</p>
      <p class="tiny zh" style="margin-top:5px">${left
        ? `本周建议量还剩 ${left} 条。`
        : `已达到每周 ${S.WEEKLY_NEW_TARGET} 条建议量；仍可收录，后续复习将自动顺延约 ${delayDays} 天。`}</p>
      <button class="btn ${primaryExisting ? 'btn-ghost' : 'btn-pri'} btn-blk" id="cap-add" style="margin-top:12px">
        ${admission === 'reuse' || primaryExisting ? '练习已有表达' : '加入并开始练习'}
      </button>
    </div>` : `<div class="card flat">
      <p class="zh" style="font-weight:600">这次不需要新增表达</p>
      <p class="tiny zh" style="margin-top:5px">结果可以直接使用；不生成空句型，也不强制进入练习。</p>
      <button class="btn btn-pri btn-blk" id="cap-complete" style="margin-top:12px">完成</button>
    </div>`}
    <div id="cap-drill"></div>
  </div>`;

  $('#cap-edit')?.addEventListener('click', () => {
    input.hidden = false;
    out.innerHTML = '';
    $('#cap')?.focus({ preventScroll: true });
    input.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#say-nat')?.addEventListener('click', () => SP.say(r.natural));
  $('#say-sp')?.addEventListener('click', () => SP.say(r.spoken));
  $('#say-sk')?.addEventListener('click', () => SP.say(p?.skeleton || ''));
  $('#say-bonus')?.addEventListener('click', () => SP.say(r.bonus.skeleton));
  $('#cap-add')?.addEventListener('click', () => admit());
  $('#cap-add-bonus')?.addEventListener('click', () => admitBonus());
  $('#cap-complete')?.addEventListener('click', () => {
    S.clearDraft('expression');
    if (S.getDraft('quickCapture').trim() === raw.trim()) {
      S.clearDraft('quickCapture');
    }
    if (pendingFlashId) {
      S.markFlashHandled(pendingFlashId);
      pendingFlashId = null;
      go('library', { section: 'records', restore: true });
      return;
    }
    go('home');
  });
  $('#cap-keep-original')?.addEventListener('click', () => {
    if (!pendingFlashId) return;
    S.markFlashHandled(pendingFlashId);
    toast('记录已处理');
    go('library', { section: 'records', restore: true });
  });

  function admit() {
    if (!p) return;
    if (!pendingFlashId) {
      S.clearDraft('expression');
      if (S.getDraft('quickCapture').trim() === raw.trim()) {
        S.clearDraft('quickCapture');
      }
    }
    const it = admission === 'reuse' && reusedItem
      ? reusedItem
      : S.addItem({
        kind: p.kind,
        skeleton: p.skeleton,
        zh: p.zh,
        lemma: p.lemma,
        sense: p.sense,
        collocations: p.collocations,
        anchorSentence: p.anchorSentence,
        relatedExpressionIds: p.relatedExpressionIds,
        domainTags: p.domainTags,
        trigger: p.trigger,
        why: p.why,
        register: p.register,
        tags: p.tags,
        seeds: p.seeds,
        drill: r.drill || null,
        srcKind: r.mode === 'fragment' ? 'fragment' : r.mode,
        raw,
      });
    const cue = cueFor(it);
    if (pendingFlashId) {
      S.markFlashHandled(pendingFlashId, it.id);
      pendingFlashId = null;
    }
    const d = drillCard(it, cue, {
      label: '首次练习',
      sessionSource: 'capture',
      sessionSourceId: it.id,
      onGraded: () => { toast('已加入表达库'); offerExitDrill(it.id); },
    });
    $('#cap-drill').innerHTML = d.html; d.mount();
    $('#cap-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function admitBonus() {
    const bonus = r.bonus;
    if (!bonus) return;
    const it = S.addItem({
      skeleton: bonus.skeleton,
      zh: bonus.zh,
      trigger: bonus.trigger,
      why: bonus.why,
      register: bonus.register,
      tags: bonus.tags,
      seeds: bonus.seeds,
      drill: bonus.drill,
      srcKind: r.mode === 'fragment' ? 'fragment' : r.mode,
      raw,
    });
    if (pendingFlashId) S.markFlashHandled(pendingFlashId, it.id);
    const button = $('#cap-add-bonus');
    if (button) {
      button.disabled = true;
      button.classList.remove('btn-pri');
      button.classList.add('btn-ghost');
      button.textContent = '已加入表达库';
    }
    const d = drillCard(it, cueFor(it), {
      label: '相关表达练习',
      sessionSource: 'capture-related',
      sessionSourceId: it.id,
      onGraded: () => {
        toast('相关表达已加入表达库');
        offerExitDrill(it.id, '#cap-bonus-drill');
      },
    });
    $('#cap-bonus-drill').innerHTML = d.html;
    d.mount();
    $('#cap-bonus-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
function offerExitDrill(justAddedId, selector = '#cap-drill') {
  const nxt = S.dueItems().find(i => i.id !== justAddedId);
  const box = $(selector);
  if (!nxt || !box) { go('home'); return; }
  const cue = cueFor(nxt);
  const d = drillCard(nxt, cue, {
    label: '再复习一个表达',
    skippable: true,
    sessionSource: 'due-review',
    sessionSourceId: nxt.id,
    onSkip: () => go('home'),
    onGraded: () => go('home'),
  });
  box.innerHTML = `<p class="tiny zh center" style="margin:16px 0 10px">刚才的表达已经保存。还有一个到期表达，可现在完成。</p>` + d.html;
  d.mount();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const srcLabel = (m) => ({ heard: '听到的表达', fragment: '补全的表达', mine: '修改原句', zh: '中文转英文' }[m] || '生成表达');

/* ---------------------------------------------------------------- 骨架详情 */
export function itemSheet(id) {
  const i = S.getItem(id); if (!i) return;
  const ok = i.history.filter(h => h.ok).length;
  const currentCue = cueFor(i);
  const isTerm = i.kind === 'term';
  const relatedExpressions = isTerm
    ? (i.relatedExpressionIds || []).map(S.getItem).filter(Boolean)
    : [];
  openSheet(isTerm ? '词汇详情' : '表达详情', `
    <p class="skel en" style="font-size:21px">${skel(i.skeleton)} <button class="link" id="is-say">朗读</button></p>
    <p class="zh sub" style="margin-top:5px">${esc(i.zh)}</p>
    ${isTerm && i.collocations?.length ? `<div style="margin-top:13px">
      <div class="eyebrow">常见搭配</div>
      <div class="chips" style="margin-top:7px">${i.collocations.map(value => `<span class="chip">${esc(value)}</span>`).join('')}</div>
    </div>` : ''}
    ${isTerm && i.anchorSentence ? `<div style="margin-top:13px">
      <div class="eyebrow">场景锚点</div>
      <p class="en" style="margin-top:7px">${esc(i.anchorSentence)}</p>
    </div>` : ''}
    ${isTerm && relatedExpressions.length ? `<div style="margin-top:13px">
      <div class="eyebrow">关联表达</div>
      ${relatedExpressions.map(item => `<p class="en" style="margin-top:7px">${skel(item.skeleton)}</p>`).join('')}
    </div>` : ''}
    <p class="zh" id="is-trigger" style="margin-top:11px" ${i.trigger ? '' : 'hidden'}><b>触发时机：</b><span>${esc(i.trigger)}</span></p>
    <div class="chips" style="margin-top:11px">${srcPill(i.source.kind)}
      <span class="chip ${i.status === 'owned' ? 'acc' : ''}">${i.status === 'owned' ? '已掌握' : i.status === 'retired' ? '已归档' : '学习中'}</span>
      <span class="chip">使用 ${i.usedReal.length} 次</span></div>
    <p class="zh" style="margin-top:13px;font-weight:600">${esc(i.why || '')}</p>

    <div class="card flat" style="margin-top:14px">
      <div class="kv"><b>复习进度</b><span>${ladderHTML(i.box, i.status === 'owned')} ${S.LADDER[i.box]} 天</span></div>
      <div class="kv"><b>下次复习</b><span>${i.dueAt === Infinity ? '已完成' : inWords(i.dueAt)}</span></div>
      <div class="kv"><b>练习记录</b><span>${ok} 次通过 / ${i.history.length} 次</span></div>
      <div class="kv"><b>添加时间</b><span>${ago(i.createdAt)}</span></div>
    </div>

    ${i.source.raw ? `<div class="sec" style="margin-top:16px"><span class="eyebrow">它是怎么来的</span><hr/></div>
      <p class="quote ${/[\u4e00-\u9fa5]/.test(i.source.raw) ? 'zh' : 'en'}" style="margin-top:9px">${esc(i.source.raw)}</p>` : ''}

    <div class="sec" style="margin-top:16px"><span class="eyebrow">复习提示</span><hr/></div>
    <div class="card flat" style="margin-top:9px">
      <p class="zh" id="is-cue-text">${esc(currentCue.brief)}</p>
      <div class="row" style="margin-top:10px;justify-content:space-between">
        <p class="tiny zh" id="is-cue-status">${hasSpecificReviewCue(i) && i.trigger ? '已保存触发时机与具体提示' : '可补充触发时机与具体提示'}</p>
        <button class="btn btn-ghost btn-sm" id="is-cue-regenerate" type="button">${hasSpecificReviewCue(i) ? '重新生成' : '生成具体提示'}</button>
      </div>
    </div>

    <div class="sec" style="margin-top:16px"><span class="eyebrow">我的练习</span><hr/></div>
    ${i.mine.length ? i.mine.map(m => `<div class="li"><div class="grow"><p class="en" style="font-size:14px">${esc(m.text)}</p>
      <p class="tiny zh">${esc(m.ctx || '')} · ${ago(m.at)}</p></div></div>`).join('')
      : `<p class="dim zh" style="padding:10px 0">还没有练习记录。</p>`}

    <div class="sec" style="margin-top:14px"><span class="eyebrow">参考例句</span><hr/></div>
    <ul class="bul en" style="margin-top:7px">${(i.seeds || []).map(s => `<li>${esc(s)}</li>`).join('') || '<li class="zh">—</li>'}</ul>

    <div class="row" style="margin-top:18px">
      <button class="btn btn-pri grow btn-sm" id="is-drill">现在练一次</button>
      ${!isTerm && canStartRoleplay(i) ? '<button class="btn btn-ghost btn-sm" id="is-roleplay">情境对话</button>' : ''}
      <button class="btn btn-ghost btn-sm" id="is-used">记录已使用</button>
      <button class="btn btn-ghost btn-sm" id="is-ret">${i.status === 'retired' ? '恢复' : '归档'}</button>
    </div>`, () => {
    $('#is-say').addEventListener('click', () => SP.say(i.skeleton));
    $('#is-roleplay')?.addEventListener('click', () => {
      closeSheet();
      go('roleplay', i.id);
    });
    $('#is-used').addEventListener('click', () => { S.markUsedReal(i.id, ''); closeSheet(); toast('已记入真实使用 ✓'); go(location.hash.slice(1) || 'home'); });
    $('#is-ret').addEventListener('click', () => { i.status === 'retired' ? S.revive(i.id) : S.retire(i.id); closeSheet(); toast('已更新'); go(location.hash.slice(1) || 'home'); });
    $('#is-cue-regenerate').addEventListener('click', async () => {
      const button = $('#is-cue-regenerate');
      const status = $('#is-cue-status');
      button.disabled = true;
      button.textContent = '正在生成…';
      status.textContent = '正在根据原始内容和参考例句生成';
      try {
        const cue = await regenerateCueForItem(i);
        const cueText = $('#is-cue-text');
        if (cueText) cueText.textContent = cue.brief;
        const triggerText = $('#is-trigger');
        if (triggerText) {
          triggerText.querySelector('span').textContent = cue.trigger;
          triggerText.hidden = !cue.trigger;
        }
        status.textContent = '已保存触发时机与具体提示';
        button.textContent = '重新生成';
        toast('具体提示已保存');
      } catch (error) {
        status.textContent = L.userMessage(error);
        button.textContent = '重试';
      } finally {
        button.disabled = false;
      }
    });
    $('#is-drill').addEventListener('click', () => {
      closeSheet();
      const app = $('#app');
      const cue = cueFor(i);
      const d = drillCard(i, cue, {
        label: '临时加练',
        sessionSource: 'library',
        sessionSourceId: i.id,
        onGraded: () => go('home'),
      });
      app.innerHTML = `<div class="view stack"><button class="link mute" id="bk">‹ 返回</button>${d.html}</div>`;
      d.mount(); $('#bk').addEventListener('click', () => go('home'));
    });
  });
}

export function viewDrillItem(app, id, initialAnswer = '') {
  const item = S.getItem(id);
  if (!item) {
    go('home');
    return;
  }
  const notificationSession = S.activePracticeSession(
    item.id,
    'notification',
    item.id,
  );
  const drill = drillCard(item, cueFor(item), {
    label: '到期召回',
    initialAnswer,
    sessionSource: initialAnswer || notificationSession ? 'notification' : 'deep-link',
    sessionSourceId: item.id,
    onResult: () => {
      if (initialAnswer) S.removeNotificationReply(item.id, initialAnswer);
    },
    onGraded: () => {
      go('home');
    },
  });
  app.innerHTML = `<div class="view stack">
    <button class="link mute" id="bk">‹ 返回</button>
    ${drill.html}
  </div>`;
  drill.mount();
  $('#bk').addEventListener('click', () => go('home'));
  setTimeout(() => $(`#d${item.id}-a`)?.focus(), 80);
}
