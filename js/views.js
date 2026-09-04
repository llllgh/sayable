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

function speechFeedbackHTML(assessment) {
  if (!assessment) return '';
  const metrics = [
    ['可懂度', assessment.intelligibility],
    ['完整度', assessment.completeness],
    ['流利度', assessment.fluency],
    ['节奏', assessment.rhythm],
  ];
  return `<div class="voice-feedback">
    <div class="row" style="justify-content:space-between">
      <span class="eyebrow">语音反馈</span>
      <b class="voice-score">${assessment.overall}</b>
    </div>
    <div class="voice-metrics">${metrics.map(([label, score]) => `
      <div><span>${label}</span><b>${score}</b></div>`).join('')}</div>
    <p class="tiny zh">${esc(assessment.issues.join('；'))}${
      assessment.wordsPerMinute ? ` · ${assessment.wordsPerMinute} 词/分钟` : ''
    }</p>
  </div>`;
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
  const guided = support.mode === 'guided';
  const needsSpecificCue = !hasSpecificReviewCue(it);
  let activeCue = cue;
  const html = `
  <div class="card warm drill-card" id="${id}">
    <div class="row drill-head" style="justify-content:space-between;margin-bottom:12px">
      <span class="eyebrow" style="color:var(--warm)">${opts.label || '练习'}</span>
      <span class="chip ${guided ? 'warm' : ''}">${guided ? '含英文提示' : '主动回忆'}</span>
    </div>
    <div class="drill-input">
      <p class="zh" id="${id}-cue" style="font-size:17px;font-weight:650;line-height:1.5">${esc(activeCue.brief)}</p>
      ${needsSpecificCue ? `<button class="btn-text" id="${id}-regen-cue" type="button">生成更具体的提示</button>` : ''}
      ${guided ? `<div class="drill-guide">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div class="grow">
            <span class="eyebrow">目标表达</span>
            <p class="skel en">${skel(support.skeleton)}</p>
          </div>
          <button class="icon-button" id="${id}-guide-play" aria-label="朗读目标表达" title="朗读目标表达">
            <svg viewBox="0 0 24 24" class="ic"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12"/></svg>
          </button>
        </div>
        ${support.example ? `<div class="drill-example"><span class="eyebrow">参考句</span><p class="en">${esc(support.example)}</p></div>` : ''}
      </div>` : ''}
      <p class="dim zh" style="margin-top:9px">${guided
        ? '参考上面的表达，完整说出一句即可。'
        : '现在不显示英文提示，按中文场景完整说一句。'}</p>
      <div class="row" style="margin-top:14px;align-items:flex-start">
        <textarea class="grow" id="${id}-a" rows="3" placeholder="说出或输入英文句子">${esc(opts.initialAnswer || '')}</textarea>
        <button class="mic" id="${id}-mic" aria-label="开始录音" title="开始录音">
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="drill-actions ${opts.skippable ? 'has-skip' : ''}">
        <button class="btn btn-warm" id="${id}-go">提交答案</button>
        <button class="btn btn-ghost" id="${id}-reveal">${guided ? '还不会' : '查看答案'}</button>
        ${opts.skippable ? `<button class="btn-text" id="${id}-skip">稍后</button>` : ''}
      </div>
    </div>
    <div id="${id}-out"></div>
  </div>`;

  function mount() {
    const root = $('#' + id); if (!root) return;
    const ta = $('#' + id + '-a'), out = $('#' + id + '-out');
    let recording = false, done = false;
    let speechAssessment = null;
    const micButton = $('#' + id + '-mic');
    const submitButton = $('#' + id + '-go');
    const revealButton = $('#' + id + '-reveal');
    const stopRecording = () => {
      recording = false;
      micButton?.classList.remove('rec');
      micButton?.setAttribute('aria-label', '开始录音');
      SP.stop();
    };
    const lockInput = (stateClass) => {
      stopRecording();
      root.classList.add(stateClass);
      if (micButton) micButton.disabled = true;
      if (submitButton) submitButton.disabled = true;
      if (revealButton) revealButton.disabled = true;
      ta.readOnly = true;
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
        const cueText = $('#' + id + '-cue');
        if (cueText) cueText.textContent = activeCue.brief;
        button.remove();
        toast('具体提示已保存');
      } catch (error) {
        button.disabled = false;
        button.textContent = '重试生成具体提示';
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
        referenceText: it.skeleton,
        onText: t => { ta.value = t; },
        onAssessment: assessment => { speechAssessment = assessment; },
        onEnd: stopRecording,
        onError: e => { stopRecording(); toast(e.message); },
      });
    });

    $('#' + id + '-reveal')?.addEventListener('click', () => {
      if (done) return;
      lockInput('is-complete');
      out.innerHTML = `<div class="drill-result">
        <div class="eyebrow" style="margin-bottom:6px">参考答案</div>
        <p class="skel en">${skel(it.skeleton)}</p>
        ${support.example ? `<p class="en sub" style="margin-top:8px">${esc(support.example)}</p>` : ''}
        <p class="dim zh" style="margin-top:8px">${esc(it.why || '')}</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-pri grow" id="${id}-again">再练一次</button></div>
      </div>`;
      S.grade(it.id, false, { answer: '', ms: Date.now() - t0, ctx: activeCue.ctx, why: 'revealed' });
      opts.onResult?.(false);
      SP.say(support.example || it.skeleton);
      $('#' + id + '-again')?.addEventListener('click', () => opts.onGraded?.(false));
      done = true;
    });

    $('#' + id + '-go')?.addEventListener('click', async () => {
      const ans = ta.value.trim();
      if (words(ans) < 3) { toast('至少说一个完整的句子'); return; }
      lockInput('is-submitting');
      out.innerHTML = thinking('正在检查表达');
      let r;
      try {
        r = await L.judge({ skeleton: it.skeleton, zh: it.zh, brief: activeCue.brief, answer: ans, seeds: it.seeds });
      } catch (e) {
        out.innerHTML = `<div class="drill-result"><p class="zh sub">${esc(L.userMessage(e))}</p>
          <p class="tiny zh" style="margin-top:7px">可先记录自己的判断：</p>
          <div class="row wrap" style="margin-top:8px"><button class="btn btn-sm grow" id="${id}-self-ok">我说对了</button><button class="btn btn-sm btn-ghost" id="${id}-self-close">差一点</button><button class="btn btn-sm btn-ghost" id="${id}-self-no">没说出来</button></div></div>`;
        $('#' + id + '-self-ok')?.addEventListener('click', () => finish(true, { verdict: '你自己判为通过' }, ans));
        $('#' + id + '-self-close')?.addEventListener('click', () => finish(false, { verdict: '差一点，8 小时后再来', note: '离线自评：差一点' }, ans));
        $('#' + id + '-self-no')?.addEventListener('click', () => finish(false, { verdict: '你自己判为没过' }, ans));
        return;
      }
      finish(!!r.ok, r, ans);
    });

    function finish(ok, r, ans) {
      const feedback = buildJudgementFeedback(ans, { ...r, ok });
      S.grade(it.id, ok, {
        answer: ans,
        ms: Date.now() - t0,
        ctx: activeCue.ctx,
        why: feedback.note || feedback.correction?.summary || '',
      });
      opts.onResult?.(ok);
      const nxt = S.getItem(it.id);
      root.classList.remove('is-submitting');
      root.classList.add('is-complete');
      out.innerHTML = `
      <div class="drill-result">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="eyebrow" style="color:${ok ? 'var(--acc)' : 'var(--rose)'}">${ok ? '通过' : '再练一次'}</span>
          ${ladderHTML(nxt.box, nxt.status === 'owned', { labeled: true })}
        </div>
        <p class="zh" style="font-weight:600">${esc(feedback.verdict)}</p>
        ${judgementDiffHTML(feedback.correction, '需要调整')}
        ${judgementDiffHTML(feedback.tighter, '更紧说法')}
        ${feedback.note ? `<p class="judgement-note zh"><b>为什么：</b>${esc(feedback.note)}</p>` : ''}
        ${speechFeedbackHTML(speechAssessment)}
        <p class="skel en" style="margin-top:12px">${skel(it.skeleton)} <button class="link" id="${id}-play" style="margin-left:6px">朗读</button></p>
        <div class="row wrap" style="margin-top:13px">
          <button class="btn ${ok ? 'btn-pri' : 'btn-warm'} grow" id="${id}-next">完成</button>
          <button class="btn btn-ghost" id="${id}-used">记录实际使用</button>
        </div>
        <p class="tiny zh" style="margin-top:8px">${ok ? `下次复习：${inWords(nxt.dueAt)}` : '这条会在 8 小时后再次出现。'}</p>
      </div>`;
      $('#' + id + '-play')?.addEventListener('click', () => SP.say(it.skeleton));
      $('#' + id + '-used')?.addEventListener('click', () => {
        openSheet('在哪儿用的？', `<label class="fld"><span>真实场景（会议 / 邮件 / 客户名都行）</span>
          <input type="text" id="ur-sc" placeholder="${esc(S.state.profile.scenarios?.[0] || '填写使用场景')}" /></label>
          <button class="btn btn-pri btn-blk" id="ur-ok">记下来</button>
          <p class="tiny zh" style="margin-top:12px">这一栏只有你自己能填。它决定这条骨架能不能毕业，也是这个 app 唯一的北极星指标。</p>`, () => {
          $('#ur-ok').addEventListener('click', () => {
            S.markUsedReal(it.id, $('#ur-sc').value.trim() || activeCue.ctx);
            closeSheet(); toast('已记入真实使用 ✓'); opts.onGraded?.(ok, true);
          });
        });
      });
      $('#' + id + '-next')?.addEventListener('click', () => opts.onGraded?.(ok));
      done = true;
    }
  }
  return { html, mount };
}

/* ---------------------------------------------------------------- 今天 */
/* v2 —— 撤掉「进门税」。
   原设计的错：把答题放在捕获之前。捕获是一闪而过的念头，10 秒足以浇灭它，
   更糟的是你会忘掉自己刚要记什么。而且它惩罚的恰好是最该被鼓励的行为（多捕获），
   还在它最该管用的场景（会议中、5 秒、不能开口）里彻底失效。
   保留的那一半：召回的触发不能靠意志力，也不该是一个独立的「去复习」按钮。
   改成：捕获零阻力 + 把召回挪到「处理完之后」那个你已经冷静下来的时刻。
   用时机换服从，而不是用阻塞换服从。 */
let deferDrill = false;

export function viewHome(app) {
  const m = S.metrics();
  const due = S.dueItems();
  const it = (!deferDrill && due.length) ? due[0] : null;
  const recent = S.live().slice(0, 4);
  const inbox = S.state.inbox;
  const recommendations = S.todayRecommendationDeck();
  const recommendationState = recommendations
    ? recommendationProgress(recommendations)
    : null;

  app.innerHTML = `<div class="view stack">
    <div class="page-head">
      <div class="page-head-copy">
        <h1 class="h-lg zh">今天</h1>
        <p class="sub zh">先记下来，有时间时再处理。</p>
      </div>
    </div>
    <div class="card">
      <div class="eyebrow" style="margin-bottom:9px">快速记录</div>
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="fl" rows="2" placeholder="记下一句想学或想改进的表达">${esc(S.state.draft || '')}</textarea>
        <button class="mic" id="fl-mic" aria-label="开始录音" title="开始录音"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg></button>
      </div>
      <div class="row" style="margin-top:11px">
        <button class="btn btn-pri grow" id="fl-save">保存</button>
        <button class="btn btn-ghost" id="fl-now">立即分析</button>
      </div>
    </div>

    ${inbox.length ? `<div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:4px">
        <span class="eyebrow">待处理记录</span>
        <span class="chip warm">${inbox.length} 条</span>
      </div>
      ${inbox.slice(0, 4).map(f => `<div class="li"><div class="grow" style="cursor:pointer" data-flash="${f.id}">
        <p class="${/[\u4e00-\u9fa5]/.test(f.text) ? 'zh' : 'en'}" style="font-size:14px">${esc(f.text)}</p>
        <p class="tiny">${ago(f.at)} · ${f.status === 'done' ? '已分析，点开查看' : f.status === 'analyzing' ? '正在分析' : f.status === 'failed' ? '分析未完成，点开重试' : '点开处理'}</p></div>
        <button class="btn btn-sm btn-ghost" data-drop="${f.id}" aria-label="删除记录">删除</button></div>`).join('')}
    </div>` : ''}

    <button type="button" class="recommendation-entry" data-nav="recommend">
      <span class="recommendation-entry-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="ic"><rect x="5" y="4" width="11" height="15" rx="2"/><path d="m9 8 2 2 4-4M9 14h4M18 8h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8"/></svg>
      </span>
      <span class="grow">
        <span class="eyebrow">今日推荐</span>
        <strong class="zh">${!recommendationState
          ? '生成今天的表达'
          : recommendationState.remaining
            ? `${recommendationState.remaining} 个表达待练`
            : '今日推荐已完成'}</strong>
        <small class="zh">${!recommendationState
          ? '根据你的场景生成 5 个表达'
          : recommendationState.remaining
            ? `已完成 ${recommendationState.completed} / ${recommendationState.total}`
            : `已练习 ${recommendationState.total} 个表达`}</small>
      </span>
      <svg viewBox="0 0 24 24" class="ic recommendation-entry-arrow" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>

    ${it ? `<div id="hero"></div>` : (due.length ? `<div class="card flat">
      <div class="row" style="justify-content:space-between">
        <p class="zh sub">${due.length} 条表达待复习</p>
        <button class="btn btn-sm btn-warm" id="undefer">开始复习</button>
      </div></div>` : `
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div><div class="eyebrow">今日复习</div><p class="zh" style="margin-top:5px;font-weight:650">已完成</p></div>
          <span class="chip acc">暂无到期内容</span>
        </div>
      </div>`)}

    <div class="metrics">
      <div class="metric acc"><div class="n">${m.owned}<small>/ ${m.total}</small></div><div class="k">已掌握表达</div></div>
      <div class="metric violet"><div class="n">${m.realUses}</div><div class="k">实际使用次数</div></div>
    </div>

    <div class="sec"><span class="eyebrow">常用工具</span><hr/></div>
    <div class="card flat" style="padding:6px 15px">
      ${[['compress', '精简一段表达', '保留重点，把长段落缩短'],
         ['preflight', '准备一场会议', '练习这场会马上会用到的表达']]
        .map(([r, t, d]) => `<div class="li" style="cursor:pointer" data-nav="${r}">
          <div class="grow"><p class="zh" style="font-weight:600;font-size:14.5px">${t}</p><p class="tiny zh" style="margin-top:2px">${d}</p></div>
          <span style="color:var(--fg-3)">›</span></div>`).join('')}
    </div>

    ${recent.length ? `<div class="sec"><span class="eyebrow">最近添加</span><hr/><button class="link" data-nav="library">查看全部</button></div>
    <div class="card flat" style="padding:6px 15px">
      ${recent.map(i => `<div class="li" style="cursor:pointer" data-item="${i.id}">
        <div class="grow"><p class="skel en" style="font-size:15px">${skel(i.skeleton)}</p>
          <p class="tiny zh" style="margin-top:3px">${srcPill(i.source.kind)} ${esc(i.zh)}</p></div>
        ${ladderHTML(i.box, i.status === 'owned', { labeled: true })}</div>`).join('') || '<p class="dim zh" style="padding:12px 0">还没有。</p>'}
    </div>` : ''}
  </div>`;

  /* 闪存：零阻力 */
  const fl = $('#fl');
  fl.addEventListener('input', () => S.saveDraft(fl.value));
  let rec = false;
  $('#fl-mic').addEventListener('click', () => {
    const b = $('#fl-mic');
    if (!SP.canListen()) {
      fl.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (rec) { SP.stop(); rec = false; b.classList.remove('rec'); return; }
    rec = true; b.classList.add('rec');
    SP.listen({ lang: /[a-zA-Z]/.test(fl.value) && !/[\u4e00-\u9fa5]/.test(fl.value) ? 'en-US' : 'zh-CN',
      onText: t => { fl.value = t; S.saveDraft(t); },
      onEnd: () => { rec = false; b.classList.remove('rec'); },
      onError: e => { rec = false; b.classList.remove('rec'); toast(e.message); } });
  });
  $('#fl-save').addEventListener('click', () => {
    if (!fl.value.trim()) { toast('先扔点东西进来'); return; }
    S.addFlash(fl.value); SP.stop(); toast('已保存');
    viewHome(app);
  });
  $('#fl-now').addEventListener('click', () => {
    const t = fl.value.trim(); if (!t) { toast('先扔点东西进来'); return; }
    SP.stop(); go('capture', { text: t });
  });

  $('#undefer')?.addEventListener('click', () => { deferDrill = false; viewHome(app); });
  $$('[data-flash]', app).forEach(b => b.addEventListener('click', () => go('capture', { flashId: b.dataset.flash })));
  $$('[data-drop]', app).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); S.dropFlash(b.dataset.drop); viewHome(app); }));

  /* 到期召回：邀请，不是关卡。可以一键推掉。 */
  if (it) {
    const cue = cueFor(it);
    const d = drillCard(it, cue, {
      label: '到期复习',
      skippable: true,
      onSkip: () => { deferDrill = true; viewHome(app); },
      onGraded: () => viewHome(app),
    });
    $('#hero').innerHTML = d.html;
    d.mount();
  }
  $$('[data-nav]', app).forEach(b => b.addEventListener('click', () => go(b.dataset.nav)));
  $$('[data-item]', app).forEach(b => b.addEventListener('click', () => itemSheet(b.dataset.item)));
}

/* ---------------------------------------------------------------- 收编 */
const MODE_LABEL = { zh: '中文意思', mine: '我写的英文', heard: '听到的表达', fragment: '只记得半句' };

let pendingFlashId = null;
export function viewCapture(app, arg) {
  let prefill = '';
  let cachedAnalysis = null;
  pendingFlashId = null;
  if (typeof arg === 'string') prefill = arg;
  else if (arg && arg.flashId) {
    const f = S.getFlash(arg.flashId);
    if (f) {
      prefill = f.text;
      pendingFlashId = f.id;
      cachedAnalysis = f.analysis || null;
    }
  }
  else if (arg && arg.text) prefill = arg.text;
  if (!prefill && S.state.draft) prefill = S.state.draft;
  app.innerHTML = `<div class="view stack">
    <div class="page-head">
      <div class="page-head-copy">
        <h1 class="h-lg zh">添加表达</h1>
        <p class="sub zh">${pendingFlashId ? '处理之前保存的一条记录。' : '输入中文意思或英文原句。'}</p>
      </div>
    </div>
    <div class="card" id="capture-input">
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="cap" rows="5" placeholder="例如：我想礼貌地提醒对方尽快确认">${esc(prefill)}</textarea>
        <button class="mic" id="cap-mic" aria-label="开始录音" title="开始录音">
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:11px">
        <span class="chip" id="cap-mode">自动识别</span>
        <button class="link mute" id="cap-force">指定输入类型</button>
      </div>
      <button class="btn btn-pri btn-blk" id="cap-go" style="margin-top:13px">生成表达</button>
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
  ta.addEventListener('input', () => { refresh(); if (!pendingFlashId) S.saveDraft(ta.value); }); refresh();
  if (prefill) ta.focus();

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
  }
}

function renderCaptureResult(out, r, raw, app) {
  const p = r.primary;
  const risky = /risky/i.test(p.native_check || '') || r.flagged;
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

    <div class="card acc">
      <div class="eyebrow" style="color:var(--acc)">自然表达</div>
      <p class="en" style="font-size:16.5px;margin-top:7px;line-height:1.55">${esc(r.natural)}
        <button class="link" id="say-nat" style="margin-left:6px">朗读</button></p>
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

    <div class="sec"><span class="eyebrow">核心句型</span><hr/></div>
    <div class="card acc">
      <p class="skel en">${skel(p.skeleton)} <button class="link" id="say-sk" style="margin-left:6px">朗读</button></p>
      <p class="zh" style="margin-top:5px;color:var(--fg-2);font-size:13.5px">${esc(p.zh)}</p>
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
    </div>

    ${r.bonus?.skeleton ? `<details class="result-details"><summary>查看相关表达</summary>
      <p class="skel en" style="font-size:16px;margin-top:6px">${skel(r.bonus.skeleton)}</p>
      <p class="tiny zh" style="padding-bottom:10px">${esc(r.bonus.zh || '')}</p></details>` : ''}

    <div class="card">
      <p class="zh" style="font-weight:600">加入句库并练习</p>
      <p class="tiny zh" style="margin-top:5px">${left
        ? `本周建议量还剩 ${left} 条。`
        : `已达到每周 ${S.WEEKLY_NEW_TARGET} 条建议量；仍可收录，后续复习将自动顺延约 ${delayDays} 天。`}</p>
      <button class="btn btn-pri btn-blk" id="cap-add" style="margin-top:12px">加入并开始练习</button>
    </div>
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
  $('#say-sk')?.addEventListener('click', () => SP.say(p.skeleton));
  $('#cap-add')?.addEventListener('click', () => admit());

  function admit() {
    S.saveDraft('');
    const it = S.addItem({ skeleton: p.skeleton, zh: p.zh, why: p.why, register: p.register, tags: p.tags, seeds: p.seeds, drill: r.drill || null, srcKind: r.mode === 'fragment' ? 'fragment' : r.mode, raw });
    const cue = cueFor(it);
    if (pendingFlashId) { S.dropFlash(pendingFlashId); pendingFlashId = null; }
    const d = drillCard(it, cue, { label: '首次练习', onGraded: () => { toast('已加入句库'); offerExitDrill(it.id); } });
    $('#cap-drill').innerHTML = d.html; d.mount();
    $('#cap-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
function offerExitDrill(justAddedId) {
  const nxt = S.dueItems().find(i => i.id !== justAddedId);
  const box = $('#cap-drill');
  if (!nxt || !box) { go('home'); return; }
  const cue = cueFor(nxt);
  const d = drillCard(nxt, cue, {
    label: '再复习一个表达',
    skippable: true,
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
  openSheet('表达详情', `
    <p class="skel en" style="font-size:21px">${skel(i.skeleton)} <button class="link" id="is-say">朗读</button></p>
    <p class="zh sub" style="margin-top:5px">${esc(i.zh)}</p>
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
        <p class="tiny zh" id="is-cue-status">${hasSpecificReviewCue(i) ? '已保存具体提示' : '旧条目尚未生成具体提示'}</p>
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
      <button class="btn btn-ghost btn-sm" id="is-used">记录已使用</button>
      <button class="btn btn-ghost btn-sm" id="is-ret">${i.status === 'retired' ? '恢复' : '归档'}</button>
    </div>`, () => {
    $('#is-say').addEventListener('click', () => SP.say(i.skeleton));
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
        status.textContent = '已保存具体提示';
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
      const d = drillCard(i, cue, { label: '临时加练', onGraded: () => go('home') });
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
  const drill = drillCard(item, cueFor(item), {
    label: '到期召回',
    initialAnswer,
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
