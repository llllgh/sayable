/* =========================================================================
   views2.js — 压缩台 / 会前热身 / 句库 / 画像 / 设置
   ========================================================================= */
import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import { createIcons, Eye, EyeOff } from 'lucide';
import { esc, skel, $, $$, toast, openSheet, closeSheet, ago, inWords, words, ladderHTML, srcPill, thinking } from './ui.js';
import { go, drillCard, cueFor, itemSheet } from './views.js';
import {
  batteryOptimizationIgnored,
  exactAlarmPermission,
  openExactAlarmSettings,
  requestIgnoreBatteryOptimizations,
  requestNotificationPermission,
  showTestRecall,
} from '../src/platform/notifications.ts';
import { rescheduleNotifications } from '../src/platform/lifecycle.ts';
import {
  getServiceProfile,
  hasRequiredCredentials,
  initialOnboardingRegion,
} from '../src/speech/profiles.ts';
import {
  defaultTextProviderId,
  getTextProviderProfile,
  normalizeTextProviderId,
  textProvidersForRegion,
} from '../src/llm/profiles.ts';
import {
  createCompressionRecord,
  normalizeCompressionRecord,
} from '../src/core/compressions.ts';
import {
  englishLevelLabel,
  normalizeEnglishLevel,
} from '../src/core/english-level.ts';

/* ---------------------------------------------------------------- 压缩台 */
const compressionPatternKey = (value) => String(value || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

function compressionItemFor(pattern) {
  const key = compressionPatternKey(pattern?.skeleton);
  return S.state.items.find(item => compressionPatternKey(item.skeleton) === key);
}

export function viewCompress(app) {
  const history = S.state.compressions
    .map(normalizeCompressionRecord)
    .filter(Boolean);
  const recent = history.slice(0, 5).filter(record => record.longWords > 0);
  const avg = recent.length
    ? Math.round(recent.reduce(
      (sum, record) => sum + (1 - record.shortWords / record.longWords),
      0,
    ) / recent.length * 100)
    : 0;

  app.innerHTML = `<div class="view stack">
    <div class="page-head">
      <div class="page-head-copy">
        <h1 class="h-lg zh">精简表达</h1>
        <p class="sub zh">保留重点，把一段话压缩到 15 秒。</p>
      </div>
    </div>

    ${history.length ? `<div class="metrics">
      <div class="metric acc"><div class="n">${avg}<small>%</small></div><div class="k">最近平均压缩率</div></div>
      <div class="metric violet"><div class="n">${history.length}</div><div class="k">压缩过的段落</div></div>
    </div>` : ''}

    <div class="card" id="compression-input">
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="cp" rows="6" placeholder="输入或说出一段想精简的话，中英文均可。"></textarea>
        <button class="mic" id="cp-mic" aria-label="开始录音" title="开始录音"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg></button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <span class="chip" id="cp-wc">0 词</span>
        <span class="tiny zh">建议至少 12 词</span>
      </div>
      <button class="btn btn-pri btn-blk" id="cp-go" style="margin-top:12px">开始精简</button>
    </div>
    <div id="cp-out"></div>

    ${history.length ? `<div class="sec"><span class="eyebrow">历史</span><hr/></div>
    <div class="card flat history-list" style="padding:6px 15px">${history.map(record => {
      const rate = record.longWords
        ? Math.max(0, Math.round((1 - record.shortWords / record.longWords) * 100))
        : 0;
      const collected = record.patterns.filter(compressionItemFor).length;
      return `<button type="button" class="li history-row" data-compression="${esc(record.id)}" aria-label="打开压缩记录">
        <span class="grow"><span class="en" style="display:block;font-size:13.5px">${esc(record.short)}</span>
        <span class="tiny" style="display:block"><span style="color:var(--acc)">↓ ${rate}%</span> · ${record.longWords} → ${record.shortWords} 词 · ${record.at ? ago(record.at) : '较早'}
          ${record.patterns.length ? ` · ${record.patterns.length} 套骨架` : ''}${collected ? ` · 已收编 ${collected}` : ''}</span></span>
        <span class="history-arrow" aria-hidden="true">›</span>
      </button>`;
    }).join('')}</div>` : ''}
  </div>`;

  const ta = $('#cp');
  const out = $('#cp-out');
  const micButton = $('#cp-mic');
  const compressButton = $('#cp-go');
  let rec = false;
  const stopRecording = () => {
    rec = false;
    micButton.classList.remove('rec');
    micButton.setAttribute('aria-label', '开始录音');
    SP.stop();
  };
  const wc = () => { $('#cp-wc').textContent = words(ta.value) + ' 词'; };
  const reuseInput = (value) => {
    $('#compression-input').hidden = false;
    ta.value = value;
    wc();
    ta.focus({ preventScroll: true });
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('内容已放回输入框');
  };

  const renderCompression = (record, { historical = false } = {}) => {
    $('#compression-input').hidden = true;
    const lw = record.longWords || words(record.long);
    const sw = record.shortWords || words(record.short);
    const rate = lw
      ? Math.max(0, Math.min(100, Math.round((1 - sw / lw) * 100)))
      : 0;
    const patternCards = record.patterns.length
      ? record.patterns.map((pattern, index) => {
        const existing = compressionItemFor(pattern);
        const label = existing
          ? (existing.status === 'retired' ? '已淘汰 · 可在句库恢复' : '已在句库')
          : '收编并立刻造句';
        return `<div class="card acc">
          <p class="skel en">${skel(pattern.skeleton)}</p>
          ${pattern.zh ? `<p class="zh sub" style="margin-top:4px">${esc(pattern.zh)}</p>` : ''}
          ${pattern.why ? `<p class="zh" style="margin-top:8px;font-size:13.5px">${esc(pattern.why)}</p>` : ''}
          ${pattern.seeds.length ? `<ul class="bul en" style="margin-top:8px">${pattern.seeds.map(seed => `<li>${esc(seed)}</li>`).join('')}</ul>` : ''}
          <button class="btn btn-sm ${existing ? 'btn-ghost' : 'btn-pri'}" style="margin-top:11px" data-add="${index}" ${existing ? 'disabled' : ''}>${label}</button>
        </div>`;
      }).join('')
      : '<p class="dim zh">这条旧记录没有保存可收编的骨架。</p>';

    out.innerHTML = `<div class="stack">
      <div class="page-head">
        <div class="page-head-copy"><div class="eyebrow">${historical ? `历史记录 · ${record.at ? ago(record.at) : '较早'}` : '精简结果'}</div></div>
        <button class="btn btn-sm btn-ghost" id="cp-new">重新输入</button>
      </div>
      <div class="card flat">
        <div class="eyebrow">原始表达</div>
        <p class="en" style="margin-top:7px;font-size:14px;line-height:1.55">${esc(record.long)}</p>
        <div class="row wrap" style="margin-top:12px">
          <button class="btn btn-sm btn-ghost" data-reuse="long">编辑原文</button>
          <button class="btn btn-sm btn-ghost" data-reuse="short">继续精简</button>
        </div>
      </div>
      <div class="card acc">
        <div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--acc)">精简结果</span>
          <span class="chip acc">↓ ${rate}% · ${lw} → ${sw} 词</span></div>
        <p class="en" style="font-size:16.5px;margin-top:9px;line-height:1.5">${esc(record.short)} <button class="link" id="cp-say" aria-label="朗读 15 秒版">🔊</button></p>
        <div class="bar" style="margin-top:12px"><i style="width:${rate}%"></i></div>
        ${record.kept ? `<p class="tiny zh" style="margin-top:9px">${esc(record.kept)}</p>` : ''}
      </div>

      ${record.symptom ? `<div class="card rose"><div class="eyebrow" style="color:var(--rose)">主要问题</div>
        <p class="zh" style="margin-top:7px;font-weight:600">${esc(record.symptom)}</p></div>` : ''}

      ${record.cuts.length ? `<div class="card">
        <div class="eyebrow">删减说明</div>
        ${record.cuts.map((cut, index) => `<div class="li"><div class="idx">${index + 1}</div><div class="grow">
          <p class="zh" style="font-size:14px;font-weight:600">${esc(cut.what)}</p>
          <p class="tiny zh" style="margin-top:2px">${esc(cut.why)}</p></div></div>`).join('')}
      </div>` : ''}

      <div class="sec" id="cp-patterns"><span class="eyebrow">可加入句库的句型</span><hr/></div>
      ${patternCards}
      <div id="cp-drill"></div>
    </div>`;

    $('#cp-new')?.addEventListener('click', () => {
      out.innerHTML = '';
      $('#compression-input').hidden = false;
      ta.focus({ preventScroll: true });
      $('#compression-input').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#cp-say')?.addEventListener('click', () => SP.say(record.short));
    $$('[data-reuse]', out).forEach(button => button.addEventListener('click', () => {
      reuseInput(button.dataset.reuse === 'short' ? record.short : record.long);
    }));
    $$('[data-add]', out).forEach(button => button.addEventListener('click', () => {
      const pattern = record.patterns[Number(button.dataset.add)];
      const existing = compressionItemFor(pattern);
      if (existing) {
        button.disabled = true;
        button.textContent = existing.status === 'retired'
          ? '已淘汰 · 可在句库恢复'
          : '已在句库';
        return;
      }
      const item = S.addItem({
        skeleton: pattern.skeleton,
        zh: pattern.zh,
        why: pattern.why,
        seeds: pattern.seeds,
        srcKind: 'compress',
        raw: record.long,
      });
      button.disabled = true;
      button.classList.remove('btn-pri');
      button.classList.add('btn-ghost');
      button.textContent = '已收编';
      const drill = drillCard(item, cueFor(item), {
        label: '立刻造句',
        onGraded: () => {
          toast('已收编 · 其它推荐仍保留在这里');
          $('#cp-patterns')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      });
      $('#cp-drill').innerHTML = drill.html;
      drill.mount();
      $('#cp-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  };

  ta.addEventListener('input', wc);
  micButton.addEventListener('click', () => {
    if (!SP.canListen()) {
      ta.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (rec) { stopRecording(); return; }
    rec = true;
    micButton.classList.add('rec');
    micButton.setAttribute('aria-label', '停止录音');
    SP.listen({ lang: /[\u4e00-\u9fa5]/.test(ta.value) ? 'zh-CN' : 'en-US', onText: t => { ta.value = t; wc(); },
      onEnd: stopRecording, onError: e => { stopRecording(); toast(e.message); } });
  });

  compressButton.addEventListener('click', async () => {
    stopRecording();
    const text = ta.value.trim();
    if (words(text) < 12) { toast('至少说一段（12 词以上）才有压缩空间'); return; }
    out.innerHTML = thinking('正在保留你的逻辑并压缩');
    compressButton.disabled = true;
    micButton.disabled = true;
    ta.readOnly = true;
    try {
      const result = await L.compress(text);
      const record = createCompressionRecord({
        id: S.uid(),
        at: Date.now(),
        long: text,
        longWords: words(text),
        shortWords: words(result.short),
        result,
      });
      S.state.compressions.unshift(record);
      await S.save();
      renderCompression(record);
    } catch (e) {
      out.innerHTML = `<div class="card rose"><p class="zh sub">${esc(L.userMessage(e))}</p></div>`;
    } finally {
      compressButton.disabled = false;
      micButton.disabled = false;
      ta.readOnly = false;
    }
  });

  $$('[data-compression]', app).forEach(button => button.addEventListener('click', () => {
    const record = history.find(item => item.id === button.dataset.compression);
    if (!record) return;
    renderCompression(record, { historical: true });
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

/* ---------------------------------------------------------------- 会前热身 */
export function viewPreflight(app) {
  const p = S.state.profile;
  app.innerHTML = `<div class="view stack">
    <div class="page-head">
      <div class="page-head-copy">
        <h1 class="h-lg zh">会前准备</h1>
        <p class="sub zh">根据会议内容，挑选马上会用到的表达。</p>
      </div>
    </div>
    <div class="card">
      <label class="fld"><span>会议对象、主题和关注点</span>
        <textarea id="pf" rows="3" placeholder="例如：与海外客户确认下周交付计划">${esc(p.upcoming || '')}</textarea></label>
      <button class="btn btn-pri btn-blk" id="pf-go">生成会前练习</button>
    </div>
    <div id="pf-out"></div>
  </div>`;

  $('#pf-go').addEventListener('click', async () => {
    const sc = $('#pf').value.trim();
    if (sc.length < 6) { toast('说说这场会是什么'); return; }
    const out = $('#pf-out');
    out.innerHTML = thinking('正在挑这场会真的用得上的');
    const cands = S.relevantItems(sc, 8);
    try {
      const r = await L.preflight(sc, cands);
      const reuse = (r.reuse || []).map(x => ({ ...x, it: S.getItem(x.id) })).filter(x => x.it);
      out.innerHTML = `<div class="stack">
        ${r.avoid ? `<div class="card rose"><div class="eyebrow" style="color:var(--rose)">表达提醒</div>
          <p class="zh" style="margin-top:7px">${esc(r.avoid)}</p></div>` : ''}

        <div class="sec"><span class="eyebrow">句库中的相关表达</span><hr/></div>
        ${reuse.length ? reuse.map((x, k) => `<div class="card">
          <p class="skel en">${skel(x.it.skeleton)} <button class="link" data-say="${x.it.id}">🔊</button></p>
          <p class="zh sub" style="margin-top:4px">${esc(x.it.zh)}</p>
          <p class="tiny zh" style="margin-top:7px">${esc(x.reason || '')}</p>
          <div class="row" style="margin-top:11px">
            <button class="btn btn-sm btn-warm grow" data-warm="${k}">开始练习</button>
            <button class="btn btn-sm btn-ghost" data-real="${x.it.id}">记录已使用</button>
          </div>
          <div id="pf-d-${k}"></div>
        </div>`).join('') : `<p class="dim zh">句库里还没有跟这场会强相关的骨架。</p>`}

        ${(r.fresh || []).length ? `<div class="sec"><span class="eyebrow">建议添加的表达</span><hr/></div>
        ${(r.fresh || []).map((f, k) => `<div class="card violet">
          <p class="skel en">${skel(f.skeleton)} <button class="link" data-sayt="${esc(f.skeleton)}">🔊</button></p>
          <p class="zh sub" style="margin-top:4px">${esc(f.zh || '')}</p>
          <p class="zh" style="margin-top:8px;font-size:13.5px">${esc(f.why || '')}</p>
          ${(f.seeds || []).length ? `<ul class="bul en" style="margin-top:8px">${f.seeds.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          <button class="btn btn-sm btn-pri" style="margin-top:11px" data-fresh="${k}">收编</button>
        </div>`).join('')}` : ''}
        <div id="pf-drill"></div>
      </div>`;

      $$('[data-say]', out).forEach(b => b.addEventListener('click', () => SP.say(S.getItem(b.dataset.say)?.skeleton || '')));
      $$('[data-sayt]', out).forEach(b => b.addEventListener('click', () => SP.say(b.dataset.sayt)));
      $$('[data-real]', out).forEach(b => b.addEventListener('click', () => { S.markUsedReal(b.dataset.real, sc.slice(0, 40)); toast('已记入真实使用 ✓'); }));
      $$('[data-warm]', out).forEach(b => b.addEventListener('click', () => {
        const x = reuse[+b.dataset.warm];
        const d = drillCard(x.it, { brief: x.drill || cueFor(x.it).brief, ctx: sc.slice(0, 40), target_zh: x.it.zh }, { label: '热身', onGraded: () => toast('好 —— 20 分钟后真的说出来') });
        $('#pf-d-' + b.dataset.warm).innerHTML = d.html; d.mount(); b.style.display = 'none';
      }));
      $$('[data-fresh]', out).forEach(b => b.addEventListener('click', () => {
        const f = r.fresh[+b.dataset.fresh];
        const it = S.addItem({ skeleton: f.skeleton, zh: f.zh, why: f.why, seeds: f.seeds || [], drill: f.drill ? { brief: f.drill, target_zh: f.zh } : null, srcKind: 'preflight', raw: sc });
        const d = drillCard(it, { brief: f.drill || cueFor(it).brief, ctx: sc.slice(0, 40), target_zh: f.zh }, { label: '立刻造句', onGraded: () => toast('收下了 · 明天再问你') });
        $('#pf-drill').innerHTML = d.html; d.mount();
        $('#pf-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    } catch (e) {
      out.innerHTML = `<div class="card rose"><p class="zh sub">${esc(L.userMessage(e))}</p></div>`;
    }
  });
}

/* ---------------------------------------------------------------- 句库 */
let libFilter = 'all';
export function viewLibrary(app) {
  const m = S.metrics();
  const all = S.state.items;
  const map = {
    all: all.filter(i => i.status !== 'retired'),
    due: S.dueItems(),
    silent: all.filter(i => i.status !== 'retired' && i.mine.length === 0),
    owned: all.filter(i => i.status === 'owned'),
    retired: all.filter(i => i.status === 'retired'),
  };
  const list = map[libFilter] || map.all;
  const ev = S.evolutionPairs(4);

  app.innerHTML = `<div class="view stack">
    <div class="page-head"><div class="page-head-copy"><h1 class="h-lg zh">句库</h1>
      <p class="sub zh">${m.total} 个表达 · ${m.owned} 个已掌握 · 实际使用 ${m.realUses} 次</p></div></div>

    <div class="seg">
      ${[['all', `全部 ${map.all.length}`], ['due', `到期 ${map.due.length}`], ['silent', `没说过 ${map.silent.length}`], ['owned', `已内化 ${map.owned.length}`]]
        .map(([k, t]) => `<button class="${libFilter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}
    </div>

    ${libFilter === 'silent' && map.silent.length ? `<div class="card warm"><p class="zh sub">这些表达还没有完成过口头练习。</p></div>` : ''}

    <div class="card flat" style="padding:6px 15px">
      ${list.length ? list.map(i => `<div class="li" style="cursor:pointer" data-item="${i.id}">
        <div class="grow">
          <p class="skel en" style="font-size:15.5px">${skel(i.skeleton)}</p>
          <p class="tiny zh" style="margin-top:3px">${srcPill(i.source.kind)} ${esc(i.zh)}</p>
          <div class="chips" style="margin-top:6px">
            ${i.mine.length ? `<span class="chip acc">练习 ${i.mine.length} 次</span>` : `<span class="chip warm">未练习</span>`}
            ${i.usedReal.length ? `<span class="chip violet">使用 ${i.usedReal.length} 次</span>` : ''}
            <span class="chip">${i.dueAt === Infinity ? '已完成' : inWords(i.dueAt) + '复习'}</span>
          </div>
        </div>
        <div style="text-align:right">${ladderHTML(i.box, i.status === 'owned', { labeled: true })}</div>
      </div>`).join('') : `<div class="empty"><div class="big">◍</div><p class="zh">这一栏是空的</p></div>`}
    </div>

    ${map.retired.length ? `<p class="dim zh center"><button class="link mute" data-f="retired">已淘汰 ${map.retired.length} 个</button></p>` : ''}

    ${ev.length ? `<div class="sec"><span class="eyebrow" style="color:var(--violet)">进化对照</span><hr/></div>
      ${ev.map(e => `<div class="card violet">
        <p class="tiny zh" style="margin-bottom:8px">${e.days} 天前 → 现在</p>
        <div class="compare">
          <div class="before"><div class="wc" style="color:var(--rose)">当时 · ${words(e.before)} 词</div><p class="en" style="font-size:13px">${esc(e.before)}</p></div>
          <div class="after"><div class="wc" style="color:var(--acc)">现在 · ${words(e.after)} 词</div><p class="en" style="font-size:14px">${esc(e.after)}</p></div>
        </div></div>`).join('')}` : ''}

    <div class="card flat">
      <div class="eyebrow">这一周</div>
      <div class="kv"><b>召回次数</b><span>${m.recall7} 次 · 通过率 ${m.hitRate}%</span></div>
      <div class="kv"><b>新收编</b><span>${m.newThisWeek} 条 · 建议 ${S.WEEKLY_NEW_TARGET} 条</span></div>
    </div>
  </div>`;

  $$('[data-f]', app).forEach(b => b.addEventListener('click', () => { libFilter = b.dataset.f; viewLibrary(app); }));
  $$('[data-item]', app).forEach(b => b.addEventListener('click', () => itemSheet(b.dataset.item)));
}

/* ---------------------------------------------------------------- 画像 */
const CSV = (a) => (a || []).join('、');
const parse = (s) => (s || '').split(/[、,，\n;；]+/).map(x => x.trim()).filter(Boolean);

export function profileSheet() {
  const p = S.state.profile;
  const level = p.englishLevel || { scale: 'cefr', score: '', cefr: '' };
  openSheet('我的画像', `
    <p class="tiny zh" style="margin-bottom:14px">这些选填信息只用于让分析和练习贴合你的实际场景。</p>
    <label class="fld"><span>岗位 / 你在做什么</span><input type="text" id="p-role" value="${esc(p.role)}" placeholder="填写岗位或职责（选填）" /></label>
    <label class="fld"><span>为什么要学英语</span><textarea id="p-goal" rows="2" placeholder="填写你希望用英语完成什么（选填）">${esc(p.goal || '')}</textarea></label>
    <label class="fld"><span>英语水平自评</span>
      <div class="row">
        <select id="p-level-scale" style="width:42%">
          <option value="cefr" ${level.scale === 'cefr' ? 'selected' : ''}>CEFR</option>
          <option value="ielts" ${level.scale === 'ielts' ? 'selected' : ''}>IELTS</option>
          <option value="toefl" ${level.scale === 'toefl' ? 'selected' : ''}>TOEFL iBT</option>
          <option value="toeic" ${level.scale === 'toeic' ? 'selected' : ''}>TOEIC</option>
          <option value="cet4" ${level.scale === 'cet4' ? 'selected' : ''}>英语四级</option>
          <option value="cet6" ${level.scale === 'cet6' ? 'selected' : ''}>英语六级</option>
        </select>
        <input class="grow" type="text" id="p-level-score" value="${esc(level.score || '')}" placeholder="例如 B2 或 6.5" />
      </div>
      <small id="p-level-result">${level.cefr ? `统一等级：CEFR ${esc(level.cefr)}${level.approximate ? '（近似）' : ''}` : '用于调整表达和题目难度；可留空'}</small>
    </label>
    <label class="fld"><span>常聊的话题（顿号分隔）</span><textarea id="p-dom" rows="2" placeholder="填写常聊的话题（选填）">${esc(CSV(p.domains))}</textarea></label>
    <label class="fld"><span>主要跟谁说英语</span><input type="text" id="p-cp" value="${esc(CSV(p.counterparts))}" placeholder="填写沟通对象（选填）" /></label>
    <label class="fld"><span>高频真实场景（造句和出题会轮着用）</span><textarea id="p-sc" rows="3" placeholder="填写常见沟通场景（选填）">${esc(CSV(p.scenarios))}</textarea></label>
    <label class="fld"><span>近期要面对的事</span><textarea id="p-up" rows="2" placeholder="填写近期场景（选填）">${esc(p.upcoming)}</textarea></label>
    <button class="btn btn-pri btn-blk" id="p-save">保存</button>`, () => {
    const updateLevelPreview = () => {
      const score = $('#p-level-score').value.trim();
      const normalized = normalizeEnglishLevel($('#p-level-scale').value, score);
      $('#p-level-result').textContent = !score
        ? '用于调整表达和题目难度；可留空'
        : normalized
          ? `统一等级：CEFR ${normalized.cefr}${normalized.approximate ? '（难度适配近似值）' : ''}`
          : '请输入有效成绩或 A1–C2';
    };
    $('#p-level-scale').addEventListener('change', updateLevelPreview);
    $('#p-level-score').addEventListener('input', updateLevelPreview);
    $('#p-save').addEventListener('click', () => {
      const levelScore = $('#p-level-score').value.trim();
      const englishLevel = levelScore
        ? normalizeEnglishLevel($('#p-level-scale').value, levelScore)
        : null;
      if (levelScore && !englishLevel) {
        toast('英语水平格式不正确');
        return;
      }
      Object.assign(S.state.profile, {
        role: $('#p-role').value.trim(), goal: $('#p-goal').value.trim(),
        englishLevel,
        domains: parse($('#p-dom').value),
        counterparts: parse($('#p-cp').value), scenarios: parse($('#p-sc').value),
        upcoming: $('#p-up').value.trim(),
      });
      S.save(); closeSheet(); toast(
        englishLevel ? `画像已更新 · ${englishLevelLabel(englishLevel)}` : '画像已更新',
      ); go(location.hash.slice(1) || 'home');
    });
  });
}

/* ---------------------------------------------------------------- 首启接入 */
function providerOptionsHTML(region, selectedId) {
  if (!region) return '<option value="">请先选择服务区域</option>';
  return textProvidersForRegion(region)
    .map(provider => (
      `<option value="${provider.id}" ${provider.id === selectedId ? 'selected' : ''}>${esc(provider.label)}</option>`
    ))
    .join('');
}

function secretInputHTML(id, placeholder, extraAttributes = '') {
  return `<div class="secret-field">
    <input type="password" id="${id}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${esc(placeholder)}" ${extraAttributes} />
    <button type="button" class="secret-toggle" data-secret-target="${id}" aria-controls="${id}" aria-label="显示 API Key" aria-pressed="false" title="显示 API Key">
      <i data-lucide="eye" aria-hidden="true"></i>
    </button>
  </div>`;
}

function bindSecretVisibility() {
  const renderIcons = () => createIcons({
    icons: { Eye, EyeOff },
    attrs: { 'aria-hidden': 'true' },
  });

  $$('[data-secret-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(`#${button.dataset.secretTarget}`);
      const revealed = input.type === 'password';
      input.type = revealed ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(revealed));
      button.setAttribute('aria-label', revealed ? '隐藏 API Key' : '显示 API Key');
      button.title = revealed ? '隐藏 API Key' : '显示 API Key';
      button.innerHTML = `<i data-lucide="${revealed ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
      renderIcons();
      input.focus({ preventScroll: true });
    });
  });
  renderIcons();
}

export function onboardingSheet(onReady) {
  const s = S.state.settings;
  let serviceRegion = initialOnboardingRegion(
    s.apiKey,
    s.speechApiKey,
    s.serviceRegion,
  );
  let textProviderId = serviceRegion
    ? normalizeTextProviderId(s.textProviderId, serviceRegion)
    : '';
  let savedLlmApiKey = serviceRegion === s.serviceRegion ? s.apiKey : '';
  let savedSpeechApiKey = serviceRegion === s.serviceRegion ? s.speechApiKey : '';
  openSheet('连接模型与语音', `
    <p class="sub zh" style="margin-bottom:14px">选择当前网络区域，分别填写模型与语音凭证。两项服务验证成功后才能进入；Key 只写入系统安全存储。</p>
    <label class="fld"><span>服务区域</span>
      <div class="seg" id="ob-region">
        <button type="button" data-region="cn" class="${serviceRegion === 'cn' ? 'on' : ''}">中国大陆</button>
        <button type="button" data-region="global" class="${serviceRegion === 'global' ? 'on' : ''}">海外</button>
      </div>
    </label>
    <label class="fld"><span>文本模型服务</span>
      <select id="ob-provider" ${serviceRegion ? '' : 'disabled'}>${providerOptionsHTML(serviceRegion, textProviderId)}</select>
    </label>
    <label class="fld"><span id="ob-key-label">${serviceRegion ? `${esc(getTextProviderProfile(textProviderId, serviceRegion).label)} API Key` : '模型 API Key'}</span>
      ${secretInputHTML('ob-key', savedLlmApiKey ? '已安全保存；留空表示不修改' : '输入模型 API Key')}
      <small id="ob-key-help">${serviceRegion ? esc(getTextProviderProfile(textProviderId, serviceRegion).keyHelp) : '选择区域后显示可用的文本模型服务。'}</small>
    </label>
    <label class="fld"><span id="ob-speech-key-label">${serviceRegion ? `${esc(getServiceProfile(serviceRegion).speech.label)} API Key` : '语音 API Key'}</span>
      ${secretInputHTML('ob-speech-key', savedSpeechApiKey ? '已安全保存；留空表示不修改' : serviceRegion ? getServiceProfile(serviceRegion).speech.keyPlaceholder : '输入语音 API Key')}
      <small id="ob-speech-key-help">${serviceRegion ? esc(getServiceProfile(serviceRegion).speech.keyHelp) : '选择区域后显示对应的语音服务。'}</small>
    </label>
    <button class="btn btn-pri btn-blk" id="ob-test">全部测试并进入</button>
    <p class="tiny zh" id="ob-result" aria-live="polite" style="margin-top:10px">模型与语音通常使用不同的 Key；语音 Key 同时用于 ASR 和 TTS。</p>`, () => {
    bindSecretVisibility();
    const updateProviderFields = async () => {
      const select = $('#ob-provider');
      if (!serviceRegion) {
        select.disabled = true;
        select.innerHTML = providerOptionsHTML('', '');
        return;
      }
      textProviderId = normalizeTextProviderId(
        textProviderId || defaultTextProviderId(serviceRegion),
        serviceRegion,
      );
      const provider = getTextProviderProfile(textProviderId, serviceRegion);
      const speech = getServiceProfile(serviceRegion).speech;
      select.disabled = false;
      select.innerHTML = providerOptionsHTML(serviceRegion, textProviderId);
      savedLlmApiKey = await S.savedTextProviderApiKey(
        textProviderId,
        serviceRegion,
      );
      savedSpeechApiKey = await S.savedSpeechApiKey(serviceRegion);
      $('#ob-key').value = '';
      $('#ob-key').placeholder = savedLlmApiKey
        ? '已安全保存；留空表示不修改'
        : provider.keyPlaceholder;
      $('#ob-key-label').textContent = `${provider.label} API Key`;
      $('#ob-key-help').textContent = provider.keyHelp;
      $('#ob-speech-key').value = '';
      $('#ob-speech-key').placeholder = savedSpeechApiKey
        ? '已安全保存；留空表示不修改'
        : speech.keyPlaceholder;
      $('#ob-speech-key-label').textContent = `${speech.label} API Key`;
      $('#ob-speech-key-help').textContent = speech.keyHelp;
    };
    $$('#ob-region [data-region]').forEach(button => button.addEventListener('click', async () => {
      serviceRegion = button.dataset.region;
      textProviderId = serviceRegion === s.serviceRegion && s.textProviderId
        ? normalizeTextProviderId(s.textProviderId, serviceRegion)
        : defaultTextProviderId(serviceRegion);
      $$('#ob-region [data-region]').forEach(item => item.classList.toggle(
        'on',
        item.dataset.region === serviceRegion,
      ));
      await updateProviderFields();
    }));
    $('#ob-provider').addEventListener('change', async (event) => {
      textProviderId = normalizeTextProviderId(event.target.value, serviceRegion);
      await updateProviderFields();
    });
    $('#ob-test').addEventListener('click', async () => {
      if (!serviceRegion) {
        toast('请选择服务区域');
        return;
      }
      const textProvider = getTextProviderProfile(textProviderId, serviceRegion);
      const speechProfile = getServiceProfile(serviceRegion);
      const llmApiKey = $('#ob-key').value.trim() || savedLlmApiKey;
      const speechApiKey = $('#ob-speech-key').value.trim() || savedSpeechApiKey;
      const config = {
        providerMode: 'profile',
        serviceRegion,
        textProviderId: textProvider.id,
        protocol: textProvider.protocol,
        baseUrl: textProvider.baseUrl,
        apiKey: llmApiKey,
        model: textProvider.defaultModel,
      };
      if (!hasRequiredCredentials(llmApiKey, speechApiKey)) {
        toast('请填写模型和语音两个 API Key');
        return;
      }
      const button = $('#ob-test');
      const result = $('#ob-result');
      button.disabled = true;
      button.textContent = '正在验证模型…';
      let phase = 'model';
      try {
        const probe = await L.testProvider(config);
        phase = 'speech';
        result.textContent = '文本模型已连接，正在验证 ASR 和 TTS…';
        result.style.color = 'var(--fg-2)';
        button.textContent = '正在验证语音…';
        await SP.testCloudSpeech(speechProfile, speechApiKey);

        S.state.settings.supportsJsonMode = probe.supportsJsonMode;
        await S.setProviderConfig(config);
        await S.setSpeechConfig({
          serviceRegion,
          voiceMode: 'cloud',
          apiKey: speechApiKey,
          ttsVoice: speechProfile.speech.defaultVoice,
        });
        S.state.settings.onboardingValidationVersion = 1;
        S.state.settings.onboarded = true;
        await S.save();
        closeSheet(true);
        toast('模型与语音均已接入');
        onReady?.();
      } catch (error) {
        result.textContent = phase === 'model'
          ? L.userMessage(error)
          : `语音服务验证失败：${error instanceof Error ? error.message : String(error)}`;
        result.style.color = 'var(--rose)';
      } finally {
        button.disabled = false;
        button.textContent = '全部测试并进入';
      }
    });
  }, { dismissible: false });
}

/* ---------------------------------------------------------------- 设置 */
export function settingsSheet(onChange) {
  const s = S.state.settings;
  const usage = S.llmUsage();
  const region = s.serviceRegion || 'cn';
  const speechProfile = getServiceProfile(region);
  const textProvider = getTextProviderProfile(s.textProviderId, region);
  const profileLabel = `${speechProfile.label} · ${textProvider.label}`;
  openSheet('设置', `
    <div class="card ${S.isLive() ? 'acc' : 'warm'}" style="margin-bottom:16px">
      <p class="zh" style="font-weight:600">${S.isLive() ? '模型已接入' : '尚未接入模型'}</p>
      <p class="tiny zh" style="margin-top:5px">${S.isLive()
        ? `${profileLabel}配置已启用。数据保存在 ${S.storageBackend() === 'sqlite' ? 'SQLite' : 'IndexedDB'}，API Key 单独存放。`
        : '闪存可离线保存；分析、压缩和判卷需要先验证模型凭证。'}</p>
    </div>

    <label class="fld"><span>服务区域</span>
      <div class="seg" id="s-region">
        <button type="button" data-region="cn" class="${region === 'cn' ? 'on' : ''}">中国大陆</button>
        <button type="button" data-region="global" class="${region === 'global' ? 'on' : ''}">海外</button>
      </div>
    </label>
    <label class="fld"><span>文本模型服务</span>
      <select id="s-provider" ${s.providerMode === 'custom' ? 'disabled' : ''}>${providerOptionsHTML(region, textProvider.id)}</select>
    </label>
    <label class="fld"><span id="s-key-label">${s.providerMode === 'custom' ? '自定义服务' : esc(textProvider.label)} API Key</span>
      ${secretInputHTML('s-key', s.apiKey ? '已安全保存；留空表示不修改' : textProvider.keyPlaceholder)}
      <small id="s-key-help">${s.providerMode === 'custom' ? '使用自定义接入点对应的 API Key。' : esc(textProvider.keyHelp)}</small>
    </label>
    <details class="advanced" ${s.providerMode === 'custom' ? 'open' : ''}>
      <summary>高级模型配置</summary>
      <label class="toggle-row"><span><b>覆盖区域默认值</b><small>只用于自定义兼容接入点</small></span>
        <input type="checkbox" id="s-custom" ${s.providerMode === 'custom' ? 'checked' : ''} /></label>
      <label class="fld"><span>协议</span><select id="s-proto">
        <option value="chat_completions" ${s.protocol === 'chat_completions' ? 'selected' : ''}>Chat Completions</option>
        <option value="responses" ${s.protocol === 'responses' ? 'selected' : ''}>Responses API</option>
        <option value="anthropic_messages" ${s.protocol === 'anthropic_messages' ? 'selected' : ''}>Anthropic Messages</option>
      </select></label>
      <label class="fld"><span>Base URL</span><input type="url" id="s-url" value="${esc(s.baseUrl)}" placeholder="输入自定义 Base URL" /></label>
      <label class="fld"><span>模型名 / Endpoint ID</span><input type="text" id="s-mdl" value="${esc(s.model)}" placeholder="输入自定义模型标识" /></label>
    </details>
    <div class="row"><button class="btn btn-pri grow" id="s-test">测一下并保存</button><button class="btn btn-ghost" id="s-save">仅保存</button></div>
    <p class="tiny zh" id="s-test-result" style="margin-top:10px">Key 在 Android 上写入 Keystore 加密存储，不进 SQLite、日志或导出文件。</p>

    <div class="sec" style="margin-top:20px"><span class="eyebrow">语音</span><hr/></div>
    <label class="fld" style="margin-top:10px"><span>语音模式</span>
      <div class="seg" id="s-voice-mode">
        <button type="button" data-mode="system" class="${s.voiceMode !== 'cloud' ? 'on' : ''}">系统语音</button>
        <button type="button" data-mode="cloud" class="${s.voiceMode === 'cloud' ? 'on' : ''}">云端增强</button>
      </div>
    </label>
    <div id="s-cloud-fields" ${s.voiceMode === 'cloud' ? '' : 'hidden'}>
      <label class="fld"><span>${esc(speechProfile.speech.label)} API Key</span>
        ${secretInputHTML('s-speech-key', s.speechApiKey ? '已安全保存；留空表示不修改' : speechProfile.speech.keyPlaceholder)}
        <small>${esc(speechProfile.speech.keyHelp)}</small>
      </label>
      <button class="btn btn-sm btn-ghost btn-blk" id="s-test-speech">试听云端语音</button>
      <p class="tiny zh" id="s-speech-result" style="margin-top:8px">录音仅在识别时发送，不写入数据库或备份。</p>
    </div>

    <div class="sec" style="margin-top:20px"><span class="eyebrow">调用护栏</span><hr/></div>
    <div class="kv"><b>今天</b><span>${usage.todayCalls} / ${Number(s.dailyLimit || 60)} 次</span></div>
    <div class="kv"><b>本月估算</b><span>${usage.monthCalls} 次 · ${usage.monthTokens.toLocaleString()} tokens</span></div>
    <label class="fld" style="margin-top:10px"><span>每日调用上限</span><input type="number" id="s-limit" min="1" max="500" value="${Number(s.dailyLimit || 60)}" /></label>

    <div class="sec" style="margin-top:20px"><span class="eyebrow">召回通知</span><hr/></div>
    <label class="toggle-row"><span><b>只在有到期条目时提醒</b><small>每次回到前台会重排未来 7 天</small></span>
      <input type="checkbox" id="s-notify" ${s.notificationsEnabled ? 'checked' : ''} /></label>
    <label class="fld" style="margin-top:10px"><span>提醒时间</span><input type="time" id="s-time" value="${esc(s.remindAt || '21:30')}" /></label>
    <div class="row">
      <label class="fld grow"><span>静默开始</span><input type="time" id="s-quiet-start" value="${esc(s.quietStart || '23:00')}" /></label>
      <label class="fld grow"><span>静默结束</span><input type="time" id="s-quiet-end" value="${esc(s.quietEnd || '08:00')}" /></label>
    </div>
    <div class="row">
      <button class="btn btn-sm btn-ghost grow" id="s-exact">精确提醒权限</button>
      <button class="btn btn-sm btn-ghost grow" id="s-battery">电池优化白名单</button>
    </div>
    <button class="btn btn-sm btn-ghost btn-blk" id="s-test-notification" style="margin-top:8px">发送测试通知</button>

    <div class="sec" style="margin-top:20px"><span class="eyebrow">数据</span><hr/></div>
    <div class="row" style="margin-top:10px">
      <button class="btn btn-sm btn-ghost grow" id="s-exp">导出 JSON</button>
      <button class="btn btn-sm btn-ghost grow" id="s-imp">导入</button>
      <button class="btn btn-sm btn-ghost" id="s-reset">清空本机数据</button>
    </div>
    <input type="file" id="s-file" accept=".json" style="display:none" />

    <div class="sec" style="margin-top:20px"><span class="eyebrow">关于</span><hr/></div>
    <p class="tiny zh" style="margin-top:9px">MVP 请求从本机直达当前区域服务，不经过说得出的服务器；学习数据只保存在本机。</p>`, () => {
    bindSecretVisibility();
    let voiceMode = s.voiceMode === 'cloud' ? 'cloud' : 'system';
    let selectedTextProviderId = textProvider.id;
    let savedLlmApiKey = s.apiKey;
    const updateTextProviderFields = async () => {
      const custom = $('#s-custom').checked;
      const provider = getTextProviderProfile(selectedTextProviderId, region);
      $('#s-provider').disabled = custom;
      savedLlmApiKey = custom
        ? await S.savedCustomProviderApiKey(region)
        : await S.savedTextProviderApiKey(provider.id, region);
      $('#s-key').value = '';
      $('#s-key').placeholder = savedLlmApiKey
        ? '已安全保存；留空表示不修改'
        : custom
          ? '输入自定义服务 API Key'
          : provider.keyPlaceholder;
      $('#s-key-label').textContent = `${custom ? '自定义服务' : provider.label} API Key`;
      $('#s-key-help').textContent = custom
        ? '使用自定义接入点对应的 API Key。'
        : provider.keyHelp;
    };
    $$('#s-region [data-region]').forEach(button => button.addEventListener('click', async () => {
      if (button.dataset.region === S.state.settings.serviceRegion) return;
      await S.setServiceRegion(button.dataset.region);
      settingsSheet(onChange);
      onChange?.();
    }));
    $('#s-provider').addEventListener('change', async (event) => {
      selectedTextProviderId = normalizeTextProviderId(event.target.value, region);
      await updateTextProviderFields();
    });
    $('#s-custom').addEventListener('change', updateTextProviderFields);
    $$('#s-voice-mode [data-mode]').forEach(button => button.addEventListener('click', () => {
      voiceMode = button.dataset.mode;
      $$('#s-voice-mode [data-mode]').forEach(item => item.classList.toggle(
        'on',
        item.dataset.mode === voiceMode,
      ));
      $('#s-cloud-fields').hidden = voiceMode !== 'cloud';
    }));
    const readConfig = () => {
      const custom = $('#s-custom').checked;
      const provider = getTextProviderProfile(selectedTextProviderId, region);
      return {
        providerMode: custom ? 'custom' : 'profile',
        serviceRegion: region,
        textProviderId: provider.id,
        baseUrl: custom ? $('#s-url').value.trim() : provider.baseUrl,
        apiKey: $('#s-key').value.trim() || savedLlmApiKey,
        model: custom ? $('#s-mdl').value.trim() : provider.defaultModel,
        protocol: custom ? $('#s-proto').value : provider.protocol,
      };
    };
    const readSpeechConfig = () => ({
      serviceRegion: region,
      voiceMode,
      apiKey: $('#s-speech-key').value.trim() || s.speechApiKey,
      ttsVoice: s.ttsVoice || speechProfile.speech.defaultVoice,
    });
    const persistForm = async () => {
      const wasEnabled = !!S.state.settings.notificationsEnabled;
      Object.assign(S.state.settings, {
        remindAt: $('#s-time').value || '21:30',
        quietStart: $('#s-quiet-start').value || '23:00',
        quietEnd: $('#s-quiet-end').value || '08:00',
        dailyLimit: Math.max(1, Math.min(500, Number($('#s-limit').value) || 60)),
      });
      const wantsNotifications = $('#s-notify').checked;
      S.state.settings.notificationsEnabled = wantsNotifications
        ? await requestNotificationPermission()
        : false;
      if (S.state.settings.notificationsEnabled && !wasEnabled) {
        S.state.settings.notificationsEnabledAt = Date.now();
      } else if (!S.state.settings.notificationsEnabled) {
        S.state.settings.notificationsEnabledAt = 0;
      }
      await S.setProviderConfig(readConfig());
      await S.setSpeechConfig(readSpeechConfig());
      await rescheduleNotifications();
      onChange?.();
    };
    $('#s-save').addEventListener('click', async () => {
      await persistForm();
      closeSheet();
      toast(S.isLive() ? '配置已保存' : '配置不完整，模型功能暂不可用');
    });
    $('#s-test').addEventListener('click', async () => {
      const config = readConfig();
      if (!config.apiKey) { toast('请填写模型 API Key'); return; }
      if (config.providerMode === 'custom' && (!config.baseUrl || !config.model)) {
        toast('自定义接入点和模型标识都要填');
        return;
      }
      const button = $('#s-test');
      const result = $('#s-test-result');
      button.disabled = true;
      button.textContent = '测试中…';
      try {
        const probe = await L.testProvider(config);
        S.state.settings.supportsJsonMode = probe.supportsJsonMode;
        await persistForm();
        result.textContent = `连接成功 · ${probe.latencyMs} ms · ${probe.supportsJsonMode ? '支持结构化输出' : '已启用 JSON 容错解析'}`;
        result.style.color = 'var(--acc)';
        toast('模型接入已验证');
      } catch (e) {
        result.textContent = L.userMessage(e);
        result.style.color = 'var(--rose)';
      } finally {
        button.disabled = false;
        button.textContent = '测一下并保存';
      }
    });
    $('#s-test-speech').addEventListener('click', async () => {
      const config = readSpeechConfig();
      if (!config.apiKey) {
        toast('请填写语音 API Key');
        return;
      }
      const button = $('#s-test-speech');
      const result = $('#s-speech-result');
      button.disabled = true;
      button.textContent = '正在生成…';
      try {
        await SP.testCloudSpeech(speechProfile, config.apiKey);
        await S.setSpeechConfig({ ...config, voiceMode: 'cloud' });
        result.textContent = 'ASR 鉴权与云端朗读连接成功';
        result.style.color = 'var(--acc)';
      } catch (error) {
        result.textContent = error instanceof Error ? error.message : String(error);
        result.style.color = 'var(--rose)';
      } finally {
        button.disabled = false;
        button.textContent = '试听云端语音';
      }
    });
    $('#s-exact').addEventListener('click', async () => {
      const permission = await exactAlarmPermission();
      if (permission === 'granted') {
        toast('精确提醒权限已开启');
      } else {
        await openExactAlarmSettings();
      }
    });
    $('#s-battery').addEventListener('click', async () => {
      if (await batteryOptimizationIgnored()) {
        toast('已允许后台提醒');
      } else {
        await requestIgnoreBatteryOptimizations();
      }
    });
    $('#s-test-notification').addEventListener('click', async () => {
      const item = S.dueItems()[0] || S.live()[0];
      if (!item) {
        toast('句库里还没有可测试的骨架');
        return;
      }
      toast(await showTestRecall(item) ? '测试通知已发送' : '请在 Android App 内测试');
    });
    $('#s-exp').addEventListener('click', async () => {
      try {
        await S.exportToFile();
        toast('已生成不含 API Key 的备份');
      } catch (error) {
        toast('导出失败：' + (error instanceof Error ? error.message : String(error)));
      }
    });
    $('#s-imp').addEventListener('click', () => $('#s-file').click());
    $('#s-file').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          await S.importJSON(r.result);
          closeSheet();
          toast('导入成功');
          go('home');
        } catch (err) {
          toast('导入失败：' + err.message);
        }
      };
      r.readAsText(f);
    });
    $('#s-reset').addEventListener('click', async () => {
      if (!confirm('清空本机全部数据？此操作无法撤销。')) return;
      await S.resetAll();
      location.reload();
    });
  });
}
