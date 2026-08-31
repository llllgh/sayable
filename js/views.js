/* =========================================================================
   views.js — 今天 / 召回 / 收编
   ========================================================================= */
import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import { esc, skel, $, $$, toast, openSheet, closeSheet, ago, inWords, words, ladderHTML, srcPill, thinking } from './ui.js';

export let go = () => {};                 // 由 main.js 注入路由
export function bindRouter(fn) { go = fn; }

/* ---------------------------------------------------------------- 通用：造句题的本地出题 */
export function cueFor(it) {
  const sc = S.state.profile.scenarios || [];
  const scenario = sc.length ? sc[Math.floor(Math.random() * sc.length)] : '你手上正在推进的一件事';
  const seen = it.mine.map(m => m.ctx).filter(Boolean);
  const fresh = sc.filter(x => !seen.includes(x));
  return {
    brief: `用「${it.zh}」这个意思，在【${(fresh[0] || scenario)}】里说一句英文。`,
    ctx: fresh[0] || scenario,
    target_zh: it.zh,
  };
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

/* ---------------------------------------------------------------- 召回卡（核心组件） */
/* 设计要点：
   1) 答案先出（answer-first）：默认不给骨架，"看答案"按钮前 8 秒不可点 —— 
      "想不起来 → 努力想 → 再看到答案" 才形成长期记忆，直接看等于白学。
   2) 默认用嘴答，20 秒可见倒计时 —— 训练的是会议里的压力检索。
   3) 判完之后一定问一句「你在真实场景用过它吗」—— 真实使用是唯一不可伪造的掌握证据。 */
export function drillCard(it, cue, opts = {}) {
  const t0 = Date.now();
  const id = 'd' + it.id;
  const html = `
  <div class="card warm" id="${id}">
    <div class="row" style="justify-content:space-between;margin-bottom:12px">
      <span class="eyebrow" style="color:var(--warm)">${opts.label || '先答一题'}</span>
      <span class="timer" id="${id}-t"><span class="ring">
        <svg width="34" height="34"><circle cx="17" cy="17" r="14" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="3"/>
        <circle id="${id}-arc" cx="17" cy="17" r="14" fill="none" stroke="var(--warm)" stroke-width="3" stroke-linecap="round" stroke-dasharray="88" stroke-dashoffset="0"/></svg>
        <b id="${id}-n">20</b></span></span>
    </div>
    <p class="zh" style="font-size:17px;font-weight:600;line-height:1.5">${esc(cue.brief)}</p>
    ${it.mine.length === 0 ? `<p class="dim zh" style="margin-top:8px">这是它的第一次产出 —— 收进来还没自己说过的骨架，等于还没开始学。</p>` : ''}
    <div class="row" style="margin-top:14px;align-items:flex-start">
      <textarea class="grow" id="${id}-a" rows="3" placeholder="说出来或打出来（英文）">${esc(opts.initialAnswer || '')}</textarea>
      <button class="mic" id="${id}-mic" aria-label="说出答案">
        <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
      </button>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-warm grow" id="${id}-go">提交</button>
      <button class="btn btn-ghost btn-sm" id="${id}-reveal" disabled>想不起来</button>
    </div>
    ${opts.skippable ? `<p class="center" style="margin-top:9px"><button class="link mute" id="${id}-skip">先不答，我是来记东西的</button></p>` : ''}
    <div id="${id}-out"></div>
  </div>`;

  function mount() {
    const root = $('#' + id); if (!root) return;
    const ta = $('#' + id + '-a'), out = $('#' + id + '-out');
    let left = 20, stopMic = null, recording = false, done = false;
    let speechAssessment = null;

    /* 倒计时：不打断，只施加压力 */
    const tick = setInterval(() => {
      left--;
      const n = $('#' + id + '-n'), arc = $('#' + id + '-arc'), box = $('#' + id + '-t');
      if (!n) { clearInterval(tick); return; }
      n.textContent = Math.max(0, left);
      arc && (arc.style.strokeDashoffset = String(88 * (1 - Math.max(0, left) / 20)));
      if (left <= 6) box?.classList.add('hot');
      if (left <= 0) { clearInterval(tick); n.textContent = '0'; }
    }, 1000);

    $('#' + id + '-skip')?.addEventListener('click', () => { clearInterval(tick); SP.stop(); opts.onSkip?.(); });

    /* 8 秒后才允许看答案 */
    setTimeout(() => { const b = $('#' + id + '-reveal'); if (b) b.disabled = false; }, 8000);

    $('#' + id + '-mic')?.addEventListener('click', () => {
      const btn = $('#' + id + '-mic');
      if (!SP.canListen()) {
        ta.focus();
        toast('请使用系统键盘上的语音输入');
        return;
      }
      if (recording) { SP.stop(); recording = false; btn.classList.remove('rec'); return; }
      recording = true; btn.classList.add('rec');
      stopMic = SP.listen({
        lang: 'en-US',
        referenceText: it.skeleton,
        onText: t => { ta.value = t; },
        onAssessment: assessment => { speechAssessment = assessment; },
        onEnd: () => { recording = false; btn.classList.remove('rec'); },
        onError: e => { recording = false; btn.classList.remove('rec'); toast(e.message); },
      });
    });

    $('#' + id + '-reveal')?.addEventListener('click', () => {
      if (done) return;
      clearInterval(tick);
      out.innerHTML = `<div class="card flat" style="margin-top:12px">
        <div class="eyebrow" style="margin-bottom:6px">答案</div>
        <p class="skel en">${skel(it.skeleton)}</p>
        <p class="dim zh" style="margin-top:8px">${esc(it.why || '')}</p>
        <div class="row" style="margin-top:12px"><button class="btn btn-sm btn-ghost grow" id="${id}-again">好，现在自己说一遍</button></div>
        <p class="tiny zh" style="margin-top:10px">看了答案这次记为没过 —— 不是惩罚：真正让它留下来的正是「想不起来 → 努力想 → 再看到」这个过程。</p>
      </div>`;
      S.grade(it.id, false, { answer: '', ms: Date.now() - t0, ctx: cue.ctx, why: 'revealed' });
      opts.onResult?.(false);
      SP.say(it.skeleton);
      $('#' + id + '-again')?.addEventListener('click', () => { out.innerHTML = ''; ta.focus(); });
      done = true;
      opts.onGraded?.(false);
    });

    $('#' + id + '-go')?.addEventListener('click', async () => {
      const ans = ta.value.trim();
      if (words(ans) < 3) { toast('至少说一个完整的句子'); return; }
      clearInterval(tick); SP.stop();
      out.innerHTML = thinking('正在判');
      let r;
      try {
        r = await L.judge({ skeleton: it.skeleton, zh: it.zh, brief: cue.brief, answer: ans, seeds: it.seeds });
      } catch (e) {
        out.innerHTML = `<div class="card rose" style="margin-top:12px"><p class="zh sub">${esc(L.userMessage(e))}</p>
          <p class="tiny zh" style="margin-top:7px">离线自评：</p>
          <div class="row wrap" style="margin-top:8px"><button class="btn btn-sm grow" id="${id}-self-ok">我说对了</button><button class="btn btn-sm btn-ghost" id="${id}-self-close">差一点</button><button class="btn btn-sm btn-ghost" id="${id}-self-no">没说出来</button></div></div>`;
        $('#' + id + '-self-ok')?.addEventListener('click', () => finish(true, { verdict: '你自己判为通过' }, ans));
        $('#' + id + '-self-close')?.addEventListener('click', () => finish(false, { verdict: '差一点，8 小时后再来', note: '离线自评：差一点' }, ans));
        $('#' + id + '-self-no')?.addEventListener('click', () => finish(false, { verdict: '你自己判为没过' }, ans));
        return;
      }
      finish(!!r.ok, r, ans);
    });

    function finish(ok, r, ans) {
      S.grade(it.id, ok, { answer: ans, ms: Date.now() - t0, ctx: cue.ctx, why: r.note || '' });
      opts.onResult?.(ok);
      const nxt = S.getItem(it.id);
      out.innerHTML = `
      <div class="card ${ok ? 'acc' : 'rose'}" style="margin-top:12px">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <span class="eyebrow" style="color:${ok ? 'var(--acc)' : 'var(--rose)'}">${ok ? '过了' : '还没过'}</span>
          ${ladderHTML(nxt.box, nxt.status === 'owned')}
        </div>
        <p class="zh" style="font-weight:600">${esc(r.verdict || '')}</p>
        ${r.fix ? `<div class="compare" style="margin-top:11px"><div class="after"><div class="wc" style="color:var(--acc)">改成</div><p class="en">${esc(r.fix)}</p></div></div>` : ''}
        ${r.tighter ? `<div class="compare" style="margin-top:8px"><div class="after"><div class="wc" style="color:var(--acc)">还能更紧</div><p class="en">${esc(r.tighter)}</p></div></div>` : ''}
        ${r.note ? `<p class="dim zh" style="margin-top:10px">${esc(r.note)}</p>` : ''}
        ${speechFeedbackHTML(speechAssessment)}
        <p class="skel en" style="margin-top:12px">${skel(it.skeleton)} <button class="link" id="${id}-play" style="margin-left:6px">🔊 听</button></p>
        <div class="row wrap" style="margin-top:13px">
          <button class="btn btn-sm ${ok ? 'btn-pri' : 'btn-warm'} grow" id="${id}-next">${ok ? `记下了 · ${inWords(nxt.dueAt)}再问` : '8 小时后再来一次'}</button>
          <button class="btn btn-sm btn-ghost" id="${id}-used">我真会用过它</button>
        </div>
        <p class="tiny zh" style="margin-top:9px">「真会用过」是唯一模型伪造不了的掌握证据 —— 只有它能把一条判为已内化。</p>
      </div>`;
      $('#' + id + '-play')?.addEventListener('click', () => SP.say(it.skeleton));
      $('#' + id + '-used')?.addEventListener('click', () => {
        openSheet('在哪儿用的？', `<label class="fld"><span>真实场景（会议 / 邮件 / 客户名都行）</span>
          <input type="text" id="ur-sc" placeholder="${esc(S.state.profile.scenarios?.[0] || '填写使用场景')}" /></label>
          <button class="btn btn-pri btn-blk" id="ur-ok">记下来</button>
          <p class="tiny zh" style="margin-top:12px">这一栏只有你自己能填。它决定这条骨架能不能毕业，也是这个 app 唯一的北极星指标。</p>`, () => {
          $('#ur-ok').addEventListener('click', () => {
            S.markUsedReal(it.id, $('#ur-sc').value.trim() || cue.ctx);
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
  const ev = S.evolutionPairs(1)[0];
  const recent = S.live().slice(0, 4);
  const inbox = S.state.inbox;

  app.innerHTML = `<div class="view stack">

    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:9px">
        <span class="eyebrow" style="color:var(--acc)">闪存 · 捕获路径上什么都没有</span>
        <span class="chip">2 秒</span>
      </div>
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="fl" rows="2" placeholder="听到一句、想到一句、刚说得不满意的一句 —— 先扔进来就走">${esc(S.state.draft || '')}</textarea>
        <button class="mic" id="fl-mic" aria-label="口述"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg></button>
      </div>
      <div class="row" style="margin-top:11px">
        <button class="btn btn-pri grow" id="fl-save">存下就走</button>
        <button class="btn btn-ghost btn-sm" id="fl-now">现在就分析</button>
      </div>
      <p class="tiny zh" style="margin-top:9px">存下 = 不联网、不分析、不问你任何问题。分析和答题都属于「处理」，等你有 3 分钟再说。<br/>
      输入随时自动存草稿，被人打断也不会丢。</p>
    </div>

    ${inbox.length ? `<div class="card warm">
      <div class="row" style="justify-content:space-between;margin-bottom:4px">
        <span class="eyebrow" style="color:var(--warm)">待处理</span>
        <span class="chip warm">${inbox.length} 条</span>
      </div>
      ${inbox.slice(0, 4).map(f => `<div class="li"><div class="grow" style="cursor:pointer" data-flash="${f.id}">
        <p class="${/[\u4e00-\u9fa5]/.test(f.text) ? 'zh' : 'en'}" style="font-size:14px">${esc(f.text)}</p>
        <p class="tiny">${ago(f.at)} · ${f.status === 'done' ? '已分析，点开查看' : f.status === 'analyzing' ? '正在分析' : f.status === 'failed' ? '分析未完成，点开重试' : '点开处理'}</p></div>
        <button class="btn btn-sm btn-ghost" data-drop="${f.id}" style="height:28px;padding:0 9px">删</button></div>`).join('')}
      <p class="tiny zh" style="margin-top:8px">攒着不处理没关系，这里不是待办清单，是一个安全的暂存处。</p>
    </div>` : ''}

    ${it ? `<div id="hero"></div>` : (due.length ? `<div class="card flat">
      <p class="zh sub">还有 ${due.length} 条到期的召回，等你想练的时候在句库里点开就行。</p>
      <button class="btn btn-sm btn-warm" style="margin-top:10px" id="undefer">现在答一题</button></div>` : `
      <div class="card acc">
        <div class="eyebrow" style="color:var(--acc)">今天没有到期的召回</div>
        <p class="h-md zh" style="margin-top:7px">这就是正常状态。</p>
        <p class="sub zh" style="margin-top:7px">这个 app 不要求你每天学英语，只要求你「今天有没有遇到值得收编的表达」。没遇到就不用打开。</p>
      </div>`)}

    <div class="metrics">
      <div class="metric acc"><div class="n">${m.owned}<small>/ ${m.total}</small></div><div class="k">已内化（能说出来 + 真用过）</div></div>
      <div class="metric violet"><div class="n">${m.realUses}</div><div class="k">真实场景使用次数</div></div>
    </div>

    <div class="card flat">
      <div class="row" style="justify-content:space-between">
        <span class="eyebrow">本周新收编预算</span>
        <span class="chip ${m.budgetLeft ? 'acc' : 'warm'}">${m.newThisWeek} / ${S.WEEKLY_NEW_BUDGET}</span>
      </div>
      <div class="bar" style="margin-top:10px"><i style="width:${Math.min(100, m.newThisWeek / S.WEEKLY_NEW_BUDGET * 100)}%"></i></div>
      <p class="tiny zh" style="margin-top:9px">预算只限制「收编」，不限制「闪存」—— 想扔多少进来都可以。
      按每周真正掌握 3 个算，一年就是 150 个和你工作高度相关、能自动调用的结构。</p>
    </div>

    ${ev ? `<div class="card violet">
      <div class="eyebrow" style="color:var(--violet)">进化对照 · ${ev.days} 天前的你</div>
      <div class="compare" style="margin-top:11px">
        <div class="before"><div class="wc" style="color:var(--rose)">当时 · ${words(ev.before)} 词</div><p class="en" style="font-size:13.5px">${esc(ev.before)}</p></div>
        <div class="after"><div class="wc" style="color:var(--acc)">现在 · ${words(ev.after)} 词</div><p class="en" style="font-size:14px">${esc(ev.after)}</p></div>
      </div>
      <p class="tiny zh" style="margin-top:10px">进步是看得见的 —— 但只有把你自己的原话存下来才能看见。</p>
    </div>` : ''}

    <div class="sec"><span class="eyebrow">另外两个入口</span><hr/></div>
    <div class="card flat" style="padding:6px 15px">
      ${[['compress', '压缩台 30″→15″', '把你刚说完的一段话压成一句，看压缩率'],
         ['preflight', '会前 3 分钟热身', '30 分钟后要开的会，先把用得上的结构说一遍 —— 复习最好的时机']]
        .map(([r, t, d]) => `<div class="li" style="cursor:pointer" data-nav="${r}">
          <div class="grow"><p class="zh" style="font-weight:600;font-size:14.5px">${t}</p><p class="tiny zh" style="margin-top:2px">${d}</p></div>
          <span style="color:var(--fg-3)">›</span></div>`).join('')}
    </div>

    <div class="sec"><span class="eyebrow">最近收编</span><hr/><button class="link" data-nav="library">全部 ${m.total}</button></div>
    <div class="card flat" style="padding:6px 15px">
      ${recent.map(i => `<div class="li" style="cursor:pointer" data-item="${i.id}">
        <div class="grow"><p class="skel en" style="font-size:15px">${skel(i.skeleton)}</p>
          <p class="tiny zh" style="margin-top:3px">${srcPill(i.source.kind)} ${esc(i.zh)} · ${i.mine.length ? `我造过 ${i.mine.length} 句` : '<span style="color:var(--warm)">还没自己说过</span>'}</p></div>
        ${ladderHTML(i.box, i.status === 'owned')}</div>`).join('') || '<p class="dim zh" style="padding:12px 0">还没有。</p>'}
    </div>

    <p class="tiny zh center" style="margin-top:6px;opacity:.7">不记连续天数，不推排行榜。漏掉几天不欠账。</p>
  </div>`;

  /* 闪存：零阻力 */
  const fl = $('#fl');
  setTimeout(() => fl?.focus({ preventScroll: true }), 80);
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
    S.addFlash(fl.value); SP.stop(); toast('存下了 —— 现在可以走了');
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
      label: '顺手一题 · 不挡路',
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
    <div>
      <h1 class="h-lg zh">收编</h1>
      <p class="sub zh" style="margin-top:6px">${pendingFlashId ? '在处理你之前闪存下来的一条。' : '一个框，什么都能扔进来。不用先选类型，也不用挑要不要留。'}<br/>
      这一步开始才会联网、才会问你问题 —— 因为你现在有时间了。</p>
    </div>
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="cap" rows="5" placeholder="输入一段中文意思、自己说过的英文，或刚听到但没记完整的表达">${esc(prefill)}</textarea>
        <button class="mic" id="cap-mic" aria-label="口述">
          <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
        </button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:11px">
        <span class="chip" id="cap-mode">自动识别</span>
        <button class="link mute" id="cap-force">不对？我来指定</button>
      </div>
      <button class="btn btn-pri btn-blk" id="cap-go" style="margin-top:13px">分析并抽出骨架</button>
      <p class="tiny zh" style="margin-top:10px">只会给你 <b style="color:var(--acc)">1 个</b> 主骨架。给 5 个等于没给 —— 你记不住 5 个。</p>
    </div>
    <div id="cap-out"></div>
  </div>`;

  const ta = $('#cap'), chip = $('#cap-mode');
  let forced = null, recording = false;
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

  $('#cap-mic').addEventListener('click', () => {
    const btn = $('#cap-mic');
    if (!SP.canListen()) {
      ta.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (recording) { SP.stop(); recording = false; btn.classList.remove('rec'); return; }
    recording = true; btn.classList.add('rec');
    const zh = /[\u4e00-\u9fa5]/.test(ta.value) || !ta.value;
    SP.listen({ lang: zh ? 'zh-CN' : 'en-US', onText: t => { ta.value = t; refresh(); },
      onEnd: () => { recording = false; btn.classList.remove('rec'); },
      onError: e => { recording = false; btn.classList.remove('rec'); toast(e.message); } });
  });

  $('#cap-go').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (text.length < 4) { toast('先写点东西'); return; }
    const out = $('#cap-out');
    out.innerHTML = thinking('正在找英语里最自然的压缩方式');
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
    }
  });

  if (cachedAnalysis) {
    renderCaptureResult($('#cap-out'), cachedAnalysis, prefill, app);
  }
}

function renderCaptureResult(out, r, raw, app) {
  const p = r.primary;
  const risky = /risky/i.test(p.native_check || '') || r.flagged;
  const left = S.budgetLeft();
  out.innerHTML = `<div class="stack">
    <div class="card">
      <div class="eyebrow">读到的意思</div>
      <p class="sub zh" style="margin-top:6px">${esc(r.read || '')}</p>
    </div>

    <div class="card acc">
      <div class="eyebrow" style="color:var(--acc)">自然表达</div>
      <p class="en" style="font-size:16.5px;margin-top:7px;line-height:1.55">${esc(r.natural)}
        <button class="link" id="say-nat" style="margin-left:6px">🔊</button></p>
      ${r.spoken ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">15 秒口语版 · ${words(r.spoken)} 词</div>
        <p class="en" style="font-size:15.5px;margin-top:6px">${esc(r.spoken)} <button class="link" id="say-sp">🔊</button></p></div>` : ''}
    </div>

    ${r.diagnosis?.symptom ? `<div class="card rose">
      <div class="eyebrow" style="color:var(--rose)">你啰嗦的那个习惯</div>
      <p class="zh" style="margin-top:7px;font-weight:600">${esc(r.diagnosis.symptom)}</p>
      ${r.diagnosis.before ? `<div class="compare" style="margin-top:11px">
        <div class="before"><div class="wc" style="color:var(--rose)">你的 · ${words(r.diagnosis.before)} 词</div><p class="en strike" style="font-size:13.5px">${esc(r.diagnosis.before)}</p></div>
        <div class="after"><div class="wc" style="color:var(--acc)">改成 · ${words(r.diagnosis.after || '')} 词</div><p class="en" style="font-size:14px">${esc(r.diagnosis.after || '')}</p></div></div>` : ''}
      <p class="tiny zh" style="margin-top:10px">你表达啰嗦不完全是英语差 —— 你的思考信息密度高，总想把限定、因果、例外一次交代完。要练的是压缩，不是背更多词。</p>
    </div>` : ''}

    <div class="sec"><span class="eyebrow" style="color:var(--acc)">这次唯一值得拥有的东西</span><hr/></div>
    <div class="card acc">
      <p class="skel en">${skel(p.skeleton)} <button class="link" id="say-sk" style="margin-left:6px">🔊</button></p>
      <p class="zh" style="margin-top:5px;color:var(--fg-2);font-size:13.5px">${esc(p.zh)}</p>
      <p class="zh" style="margin-top:10px;font-weight:600">${esc(p.why)}</p>
      <div class="chips" style="margin-top:11px">
        ${(p.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}
        <span class="chip ${risky ? 'warm' : 'acc'}">${risky ? '⚠ 母语者不一定这么说' : '✓ 母语者会这么说'}</span>
        <span class="chip violet">${srcLabel(r.mode)}</span>
      </div>
      ${p.native_check ? `<p class="tiny zh" style="margin-top:9px">${esc(p.native_check)}</p>` : ''}
      <div style="margin-top:13px;padding-top:12px;border-top:1px solid var(--line)">
        <div class="eyebrow">迁移到你的场景</div>
        <ul class="bul en" style="margin-top:7px">${(p.seeds || []).map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>
      ${p.trap ? `<p class="tiny zh" style="margin-top:10px;color:var(--warm)">⚑ 坑：${esc(p.trap)}</p>` : ''}
    </div>

    ${r.bonus?.skeleton ? `<div class="card flat"><div class="eyebrow">顺手记（不进复习队列）</div>
      <p class="skel en" style="font-size:16px;margin-top:6px">${skel(r.bonus.skeleton)}</p>
      <p class="tiny zh">${esc(r.bonus.zh || '')} —— 只留个印象，不占你本周的 3 个名额。</p></div>` : ''}

    <div class="card ${left ? '' : 'warm'}">
      ${left ? `<p class="zh" style="font-weight:600">收下它，现在立刻造一句</p>
        <p class="tiny zh" style="margin-top:5px">本周还剩 ${left} 个名额。收进来但不马上自己说一句，等于没收。</p>
        <button class="btn btn-pri btn-blk" id="cap-add" style="margin-top:12px">收编并立刻造句</button>`
      : `<p class="zh" style="font-weight:600">本周 3 个名额已满</p>
        <p class="tiny zh" style="margin-top:5px">这是刻意的。想收它，先淘汰一个现在最用不上的。</p>
        <button class="btn btn-warm btn-blk" id="cap-swap" style="margin-top:12px">淘汰一个，换它进来</button>
        <button class="btn btn-ghost btn-blk btn-sm" id="cap-skip" style="margin-top:8px">这次不收，只看看</button>`}
    </div>
    <div id="cap-drill"></div>
  </div>`;

  $('#say-nat')?.addEventListener('click', () => SP.say(r.natural));
  $('#say-sp')?.addEventListener('click', () => SP.say(r.spoken));
  $('#say-sk')?.addEventListener('click', () => SP.say(p.skeleton));
  $('#cap-skip')?.addEventListener('click', () => toast('没收 —— 也是一种进步'));
  $('#cap-add')?.addEventListener('click', () => admit());
  $('#cap-swap')?.addEventListener('click', () => {
    const cands = S.live().sort((a, b) => (a.usedReal.length - b.usedReal.length) || (a.mine.length - b.mine.length));
    openSheet('淘汰哪一个？', cands.slice(0, 8).map(i => `<button class="btn btn-blk btn-ghost" style="margin-bottom:8px;height:auto;padding:11px 13px;justify-content:flex-start;text-align:left" data-r="${i.id}">
      <span><span class="skel en" style="font-size:14.5px">${skel(i.skeleton)}</span><br/>
      <span class="tiny zh">真实用过 ${i.usedReal.length} 次 · 我造过 ${i.mine.length} 句</span></span></button>`).join('')
      + `<p class="tiny zh">按「最没被真实用过」排前面。淘汰不删历史，只是不再问你。`, body => {
        $$('[data-r]', body).forEach(b => b.addEventListener('click', () => { S.retire(b.dataset.r); closeSheet(); toast('已淘汰，名额腾出'); admit(); }));
      });
  });

  function admit() {
    S.saveDraft('');
    const it = S.addItem({ skeleton: p.skeleton, zh: p.zh, why: p.why, register: p.register, tags: p.tags, seeds: p.seeds, srcKind: r.mode === 'fragment' ? 'fragment' : r.mode, raw });
    const cue = { brief: r.drill?.brief || cueFor(it).brief, ctx: (S.state.profile.scenarios || [''])[0], target_zh: r.drill?.target_zh || p.zh };
    if (pendingFlashId) { S.dropFlash(pendingFlashId); pendingFlashId = null; }
    const d = drillCard(it, cue, { label: '立刻造句 · 现在就用一次', onGraded: () => { toast('收编完成 · 明天会再问你一次'); offerExitDrill(it.id); } });
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
    label: '顺手一题 · 这是你今天唯一被要求的复习',
    skippable: true,
    onSkip: () => go('home'),
    onGraded: () => go('home'),
  });
  box.innerHTML = `<p class="tiny zh center" style="margin:16px 0 10px;opacity:.8">刚才那个已经收好了。趁你还在英语模式里 —— 顺手把昨天那个也说一遍？</p>` + d.html;
  d.mount();
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const srcLabel = (m) => ({ heard: '来源：真实听到（最可信）', fragment: '来源：真实听到（还原）', mine: '来源：改我的原话', zh: '来源：模型提议' }[m] || '来源：模型提议');

/* ---------------------------------------------------------------- 骨架详情 */
export function itemSheet(id) {
  const i = S.getItem(id); if (!i) return;
  const ok = i.history.filter(h => h.ok).length;
  openSheet('骨架详情', `
    <p class="skel en" style="font-size:21px">${skel(i.skeleton)} <button class="link" id="is-say">🔊</button></p>
    <p class="zh sub" style="margin-top:5px">${esc(i.zh)}</p>
    <div class="chips" style="margin-top:11px">${srcPill(i.source.kind)}
      <span class="chip ${i.status === 'owned' ? 'acc' : ''}">${i.status === 'owned' ? '已内化' : i.status === 'retired' ? '已淘汰' : '在学'}</span>
      <span class="chip">真实用过 ${i.usedReal.length} 次</span></div>
    <p class="zh" style="margin-top:13px;font-weight:600">${esc(i.why || '')}</p>

    <div class="card flat" style="margin-top:14px">
      <div class="kv"><b>阶梯</b><span>${ladderHTML(i.box, i.status === 'owned')} ${S.LADDER[i.box]} 天</span></div>
      <div class="kv"><b>下次问你</b><span>${i.dueAt === Infinity ? '不再问' : inWords(i.dueAt)}</span></div>
      <div class="kv"><b>召回</b><span>${ok} 过 / ${i.history.length} 次</span></div>
      <div class="kv"><b>收编于</b><span>${ago(i.createdAt)}</span></div>
    </div>

    ${i.source.raw ? `<div class="sec" style="margin-top:16px"><span class="eyebrow">它是怎么来的</span><hr/></div>
      <p class="quote ${/[\u4e00-\u9fa5]/.test(i.source.raw) ? 'zh' : 'en'}" style="margin-top:9px">${esc(i.source.raw)}</p>` : ''}

    <div class="sec" style="margin-top:16px"><span class="eyebrow">我自己说过的</span><hr/></div>
    ${i.mine.length ? i.mine.map(m => `<div class="li"><div class="grow"><p class="en" style="font-size:14px">${esc(m.text)}</p>
      <p class="tiny zh">${esc(m.ctx || '')} · ${ago(m.at)}</p></div></div>`).join('')
      : `<p class="dim zh" style="padding:10px 0">还没有 —— 这才是关键缺口，不是「见得不够多」。</p>`}

    <div class="sec" style="margin-top:14px"><span class="eyebrow">参考例句</span><hr/></div>
    <ul class="bul en" style="margin-top:7px">${(i.seeds || []).map(s => `<li>${esc(s)}</li>`).join('') || '<li class="zh">—</li>'}</ul>

    <div class="row" style="margin-top:18px">
      <button class="btn btn-pri grow btn-sm" id="is-drill">现在练一次</button>
      <button class="btn btn-ghost btn-sm" id="is-used">真会用过</button>
      <button class="btn btn-ghost btn-sm" id="is-ret">${i.status === 'retired' ? '恢复' : '淘汰'}</button>
    </div>`, () => {
    $('#is-say').addEventListener('click', () => SP.say(i.skeleton));
    $('#is-used').addEventListener('click', () => { S.markUsedReal(i.id, ''); closeSheet(); toast('已记入真实使用 ✓'); go(location.hash.slice(1) || 'home'); });
    $('#is-ret').addEventListener('click', () => { i.status === 'retired' ? S.revive(i.id) : S.retire(i.id); closeSheet(); toast('已更新'); go(location.hash.slice(1) || 'home'); });
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
