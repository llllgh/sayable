/* =========================================================================
   views2.js — 压缩台 / 会前热身 / 句库 / 画像 / 设置
   ========================================================================= */
import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
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

/* ---------------------------------------------------------------- 压缩台 */
export function viewCompress(app) {
  const hist = S.state.compressions.slice(0, 5);
  const avg = hist.length ? Math.round(hist.reduce((s, c) => s + (1 - c.shortWords / c.longWords), 0) / hist.length * 100) : 0;

  app.innerHTML = `<div class="view stack">
    <div>
      <h1 class="h-lg zh">压缩台</h1>
      <p class="sub zh" style="margin-top:6px">说完一段 30 秒的话，这里保留你的逻辑、压成 15 秒，并告诉你「删掉的那部分为什么英语里可以不说」。</p>
    </div>

    ${hist.length ? `<div class="metrics">
      <div class="metric acc"><div class="n">${avg}<small>%</small></div><div class="k">最近平均压缩率</div></div>
      <div class="metric violet"><div class="n">${hist.length}</div><div class="k">压缩过的段落</div></div>
    </div>` : ''}

    <div class="card">
      <div class="row" style="align-items:flex-start">
        <textarea class="grow" id="cp" rows="7" placeholder="按住麦克风，把你刚才想说（或刚说得不满意）的一整段说出来。中英都行。&#10;&#10;不用组织，越像你平时讲话越好 —— 要修的正是你平时讲话的样子。"></textarea>
        <button class="mic" id="cp-mic"><svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg></button>
      </div>
      <div class="row" style="justify-content:space-between;margin-top:10px">
        <span class="chip" id="cp-wc">0 词</span>
        <span class="tiny zh">目标：压到 35 词以内</span>
      </div>
      <button class="btn btn-pri btn-blk" id="cp-go" style="margin-top:12px">压缩</button>
    </div>
    <div id="cp-out"></div>

    ${hist.length ? `<div class="sec"><span class="eyebrow">历史</span><hr/></div>
    <div class="card flat" style="padding:6px 15px">${hist.map(c => `<div class="li">
      <div class="grow"><p class="en" style="font-size:13.5px">${esc(c.short)}</p>
      <p class="tiny"><span style="color:var(--acc)">↓ ${Math.round((1 - c.shortWords / c.longWords) * 100)}%</span> · ${c.longWords} → ${c.shortWords} 词 · ${ago(c.at)}</p></div></div>`).join('')}</div>` : ''}
  </div>`;

  const ta = $('#cp'); let rec = false;
  const wc = () => { $('#cp-wc').textContent = words(ta.value) + ' 词'; };
  ta.addEventListener('input', wc);
  $('#cp-mic').addEventListener('click', () => {
    const b = $('#cp-mic');
    if (!SP.canListen()) {
      ta.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (rec) { SP.stop(); rec = false; b.classList.remove('rec'); return; }
    rec = true; b.classList.add('rec');
    SP.listen({ lang: /[\u4e00-\u9fa5]/.test(ta.value) ? 'zh-CN' : 'en-US', onText: t => { ta.value = t; wc(); },
      onEnd: () => { rec = false; b.classList.remove('rec'); }, onError: e => { rec = false; b.classList.remove('rec'); toast(e.message); } });
  });

  $('#cp-go').addEventListener('click', async () => {
    const text = ta.value.trim();
    if (words(text) < 12) { toast('至少说一段（12 词以上）才有压缩空间'); return; }
    const out = $('#cp-out');
    out.innerHTML = thinking('正在保留你的逻辑并压缩');
    try {
      const r = await L.compress(text);
      const lw = words(text), sw = words(r.short);
      const rate = Math.max(0, Math.round((1 - sw / lw) * 100));
      out.innerHTML = `<div class="stack">
        <div class="card acc">
          <div class="row" style="justify-content:space-between"><span class="eyebrow" style="color:var(--acc)">15 秒版</span>
            <span class="chip acc">↓ ${rate}% · ${lw} → ${sw} 词</span></div>
          <p class="en" style="font-size:16.5px;margin-top:9px;line-height:1.5">${esc(r.short)} <button class="link" id="cp-say">🔊</button></p>
          <div class="bar" style="margin-top:12px"><i style="width:${rate}%"></i></div>
          ${r.kept ? `<p class="tiny zh" style="margin-top:9px">✓ ${esc(r.kept)}</p>` : ''}
        </div>

        ${r.symptom ? `<div class="card rose"><div class="eyebrow" style="color:var(--rose)">这段话里最主要的啰嗦习惯</div>
          <p class="zh" style="margin-top:7px;font-weight:600">${esc(r.symptom)}</p></div>` : ''}

        ${(r.cuts || []).length ? `<div class="card">
          <div class="eyebrow">删掉了什么，为什么可以不说</div>
          ${(r.cuts || []).map((c, k) => `<div class="li"><div class="idx">${k + 1}</div><div class="grow">
            <p class="zh" style="font-size:14px;font-weight:600">${esc(c.what)}</p>
            <p class="tiny zh" style="margin-top:2px">${esc(c.why)}</p></div></div>`).join('')}
        </div>` : ''}

        <div class="sec"><span class="eyebrow" style="color:var(--acc)">值得长期拥有的骨架</span><hr/></div>
        ${(r.patterns || []).map((p, k) => `<div class="card acc">
          <p class="skel en">${skel(p.skeleton)}</p>
          <p class="zh sub" style="margin-top:4px">${esc(p.zh || '')}</p>
          <p class="zh" style="margin-top:8px;font-size:13.5px">${esc(p.why || '')}</p>
          <button class="btn btn-sm btn-pri" style="margin-top:11px" data-add="${k}">${S.budgetLeft() ? '收编并立刻造句' : '本周名额已满（去句库淘汰一个）'}</button>
        </div>`).join('')}
        <div id="cp-drill"></div>
      </div>`;
      S.state.compressions.unshift({ id: S.uid(), at: Date.now(), long: text, short: r.short, longWords: lw, shortWords: sw, patterns: (r.patterns || []).map(p => p.skeleton) });
      S.save();
      $('#cp-say')?.addEventListener('click', () => SP.say(r.short));
      $$('[data-add]', out).forEach(b => b.addEventListener('click', () => {
        if (!S.budgetLeft()) { go('library'); return; }
        const p = r.patterns[+b.dataset.add];
        const it = S.addItem({ skeleton: p.skeleton, zh: p.zh, why: p.why, seeds: p.seeds || [], srcKind: 'compress', raw: text });
        const d = drillCard(it, cueFor(it), { label: '立刻造句', onGraded: () => go('home') });
        $('#cp-drill').innerHTML = d.html; d.mount();
        $('#cp-drill').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }));
    } catch (e) {
      out.innerHTML = `<div class="card rose"><p class="zh sub">${esc(L.userMessage(e))}</p></div>`;
    }
  });
}

/* ---------------------------------------------------------------- 会前热身 */
export function viewPreflight(app) {
  const p = S.state.profile;
  app.innerHTML = `<div class="view stack">
    <div>
      <h1 class="h-lg zh">会前 3 分钟</h1>
      <p class="sub zh" style="margin-top:6px">复习最难的不是记忆曲线，是「凭什么现在要复习」。所以把复习放在你真的马上要用它的 30 分钟前 —— 它就从任务变成了工具。</p>
    </div>
    <div class="card">
      <label class="fld"><span>30 分钟后你要开什么会 / 见谁 / 讲什么</span>
        <textarea id="pf" rows="3" placeholder="例：跟海外客户过一遍我们 AI 方案的投入产出，他们担心见不到效果，会追问什么时候能看到回报">${esc(p.upcoming || '')}</textarea></label>
      <button class="btn btn-pri btn-blk" id="pf-go">给我这场会用得上的</button>
      <p class="tiny zh" style="margin-top:10px">会后回来点一下「我真会用过它」—— 那是唯一能让骨架毕业的证据。</p>
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
        ${r.avoid ? `<div class="card rose"><div class="eyebrow" style="color:var(--rose)">这场会最该避免的说法</div>
          <p class="zh" style="margin-top:7px">${esc(r.avoid)}</p></div>` : ''}

        <div class="sec"><span class="eyebrow" style="color:var(--acc)">你已经有的 · 现在各说一遍</span><hr/></div>
        ${reuse.length ? reuse.map((x, k) => `<div class="card">
          <p class="skel en">${skel(x.it.skeleton)} <button class="link" data-say="${x.it.id}">🔊</button></p>
          <p class="zh sub" style="margin-top:4px">${esc(x.it.zh)}</p>
          <p class="tiny zh" style="margin-top:7px">为什么这场会需要它：${esc(x.reason || '')}</p>
          <div class="row" style="margin-top:11px">
            <button class="btn btn-sm btn-warm grow" data-warm="${k}">现在说一遍</button>
            <button class="btn btn-sm btn-ghost" data-real="${x.it.id}">会后：用过了</button>
          </div>
          <div id="pf-d-${k}"></div>
        </div>`).join('') : `<p class="dim zh">句库里还没有跟这场会强相关的骨架。</p>`}

        ${(r.fresh || []).length ? `<div class="sec"><span class="eyebrow" style="color:var(--violet)">这场会专属 · 你还没有的</span><hr/></div>
        ${(r.fresh || []).map((f, k) => `<div class="card violet">
          <p class="skel en">${skel(f.skeleton)} <button class="link" data-sayt="${esc(f.skeleton)}">🔊</button></p>
          <p class="zh sub" style="margin-top:4px">${esc(f.zh || '')}</p>
          <p class="zh" style="margin-top:8px;font-size:13.5px">${esc(f.why || '')}</p>
          ${(f.seeds || []).length ? `<ul class="bul en" style="margin-top:8px">${f.seeds.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          <button class="btn btn-sm btn-pri" style="margin-top:11px" data-fresh="${k}">${S.budgetLeft() ? '收编' : '名额已满'}</button>
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
        if (!S.budgetLeft()) { toast('本周名额已满，去句库淘汰一个'); return; }
        const f = r.fresh[+b.dataset.fresh];
        const it = S.addItem({ skeleton: f.skeleton, zh: f.zh, why: f.why, seeds: f.seeds || [], srcKind: 'preflight', raw: sc });
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
    <div><h1 class="h-lg zh">句库</h1>
      <p class="sub zh" style="margin-top:6px">${m.total} 个骨架 · ${m.owned} 个已内化 · 真实用过 ${m.realUses} 次。小而高频，不求多。</p></div>

    <div class="seg">
      ${[['all', `全部 ${map.all.length}`], ['due', `到期 ${map.due.length}`], ['silent', `没说过 ${map.silent.length}`], ['owned', `已内化 ${map.owned.length}`]]
        .map(([k, t]) => `<button class="${libFilter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}
    </div>

    ${libFilter === 'silent' && map.silent.length ? `<div class="card warm"><p class="zh" style="font-weight:600">这些是你真正的缺口</p>
      <p class="tiny zh" style="margin-top:5px">「认识但说不出来」不是见得不够多，是从来没在压力下产出过一次。它们排在召回队列最前面。</p></div>` : ''}

    <div class="card flat" style="padding:6px 15px">
      ${list.length ? list.map(i => `<div class="li" style="cursor:pointer" data-item="${i.id}">
        <div class="grow">
          <p class="skel en" style="font-size:15.5px">${skel(i.skeleton)}</p>
          <p class="tiny zh" style="margin-top:3px">${srcPill(i.source.kind)} ${esc(i.zh)}</p>
          <div class="chips" style="margin-top:6px">
            ${i.mine.length ? `<span class="chip acc">我造过 ${i.mine.length} 句</span>` : `<span class="chip warm">还没说过</span>`}
            ${i.usedReal.length ? `<span class="chip violet">真用过 ${i.usedReal.length} 次</span>` : ''}
            <span class="chip">${i.dueAt === Infinity ? '不再问' : inWords(i.dueAt) + '问'}</span>
          </div>
        </div>
        <div style="text-align:right">${ladderHTML(i.box, i.status === 'owned')}</div>
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
      <div class="kv"><b>新收编</b><span>${m.newThisWeek} / ${S.WEEKLY_NEW_BUDGET}</span></div>
      <p class="tiny zh" style="margin-top:9px">只有两个指标上首页：已内化数、真实使用次数。其它都是排查用的，不该占你注意力。</p>
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
  openSheet('我的画像', `
    <p class="tiny zh" style="margin-bottom:14px">这几栏会进到每一次分析的提示词里 —— 决定给你的例句是「关于图书馆和天气」还是「关于你下周那个客户会」。这是练习句子能不能贴合实际的唯一开关。</p>
    <label class="fld"><span>岗位 / 你在做什么</span><input type="text" id="p-role" value="${esc(p.role)}" placeholder="产品负责人 / 后端工程师 / 解决方案架构师" /></label>
    <label class="fld"><span>常聊的话题（顿号分隔）</span><textarea id="p-dom" rows="2" placeholder="AI 产品落地、模型效果、研发效率、客户 ROI">${esc(CSV(p.domains))}</textarea></label>
    <label class="fld"><span>主要跟谁说英语</span><input type="text" id="p-cp" value="${esc(CSV(p.counterparts))}" placeholder="海外客户、海外同事、公司高管" /></label>
    <label class="fld"><span>高频真实场景（造句和出题会轮着用）</span><textarea id="p-sc" rows="3" placeholder="客户方案沟通会、跟 leader 汇报进展、跨时区周会、面向高管的季度复盘">${esc(CSV(p.scenarios))}</textarea></label>
    <label class="fld"><span>近期要面对的事</span><textarea id="p-up" rows="2" placeholder="下周要跟一个海外客户讲我们 AI 方案的投入产出">${esc(p.upcoming)}</textarea></label>
    <button class="btn btn-pri btn-blk" id="p-save">保存</button>`, () => {
    $('#p-save').addEventListener('click', () => {
      Object.assign(S.state.profile, {
        role: $('#p-role').value.trim(), domains: parse($('#p-dom').value),
        counterparts: parse($('#p-cp').value), scenarios: parse($('#p-sc').value),
        upcoming: $('#p-up').value.trim(),
      });
      S.save(); closeSheet(); toast('画像已更新 ✓'); go(location.hash.slice(1) || 'home');
    });
  });
}

/* ---------------------------------------------------------------- 首启接入 */
export function onboardingSheet(onReady) {
  const s = S.state.settings;
  openSheet('连接你的模型', `
    <p class="sub zh" style="margin-bottom:14px">只配置一次。请求从本机直达你的接入点，Key 不会写入学习数据库或备份。</p>
    <label class="fld"><span>协议</span><select id="ob-proto">
      <option value="chat_completions">Chat Completions</option>
      <option value="responses">Responses API</option>
    </select></label>
    <label class="fld"><span>Base URL</span><input type="url" id="ob-url" value="${esc(s.baseUrl)}" placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
    <label class="fld"><span>API Key</span><input type="password" id="ob-key" autocomplete="off" placeholder="输入 API Key" /></label>
    <label class="fld"><span>模型名 / Endpoint ID</span><input type="text" id="ob-model" value="${esc(s.model)}" placeholder="ep-..." /></label>
    <button class="btn btn-pri btn-blk" id="ob-test">测一下并进入</button>
    <button class="btn btn-ghost btn-blk btn-sm" id="ob-demo" style="margin-top:8px">先用演示模式</button>
    <p class="tiny zh" id="ob-result" style="margin-top:10px"></p>`, () => {
    $('#ob-test').addEventListener('click', async () => {
      const config = {
        protocol: $('#ob-proto').value,
        baseUrl: $('#ob-url').value.trim(),
        apiKey: $('#ob-key').value.trim(),
        model: $('#ob-model').value.trim(),
      };
      if (!config.baseUrl || !config.apiKey || !config.model) {
        toast('接入点、Key、模型都要填');
        return;
      }
      const button = $('#ob-test');
      const result = $('#ob-result');
      button.disabled = true;
      button.textContent = '正在连接…';
      try {
        const probe = await L.testProvider(config);
        S.state.settings.supportsJsonMode = probe.supportsJsonMode;
        S.state.settings.onboarded = true;
        await S.setProviderConfig(config);
        closeSheet();
        toast('模型已接入');
        onReady?.();
      } catch (error) {
        result.textContent = L.userMessage(error);
        result.style.color = 'var(--rose)';
      } finally {
        button.disabled = false;
        button.textContent = '测一下并进入';
      }
    });
    $('#ob-demo').addEventListener('click', async () => {
      S.state.settings.onboarded = true;
      await S.save();
      closeSheet();
      onReady?.();
    });
  });
}

/* ---------------------------------------------------------------- 设置 */
export function settingsSheet(onChange) {
  const s = S.state.settings;
  const usage = S.llmUsage();
  openSheet('设置', `
    <div class="card ${S.isLive() ? 'acc' : 'warm'}" style="margin-bottom:16px">
      <p class="zh" style="font-weight:600">${S.isLive() ? '真实模型已接入' : '当前是演示模式'}</p>
      <p class="tiny zh" style="margin-top:5px">${S.isLive()
        ? `请求直接从本机发往接入点。数据保存在 ${S.storageBackend() === 'sqlite' ? 'SQLite' : 'IndexedDB'}，API Key 单独存放。`
        : '演示模式下分析结果是预置样例。填入接入点并测试通过即可使用真实模型。'}</p>
    </div>

    <label class="fld"><span>协议</span><select id="s-proto">
      <option value="chat_completions" ${s.protocol === 'chat_completions' ? 'selected' : ''}>Chat Completions</option>
      <option value="responses" ${s.protocol === 'responses' ? 'selected' : ''}>Responses API</option>
      <option value="anthropic_messages" ${s.protocol === 'anthropic_messages' ? 'selected' : ''}>Anthropic Messages</option>
    </select></label>
    <label class="fld"><span>Base URL（填到 /v1 或 /api/v3）</span><input type="url" id="s-url" value="${esc(s.baseUrl)}" placeholder="https://ark.cn-beijing.volces.com/api/v3" /></label>
    <label class="fld"><span>API Key</span><input type="password" id="s-key" value="" autocomplete="off" placeholder="${s.apiKey ? '已安全保存；留空表示不修改' : '输入 API Key'}" /></label>
    <label class="fld"><span>模型名 / Endpoint ID</span><input type="text" id="s-mdl" value="${esc(s.model)}" placeholder="ep-..." /></label>
    <div class="row"><button class="btn btn-pri grow" id="s-test">测一下并保存</button><button class="btn btn-ghost" id="s-save">仅保存</button></div>
    <p class="tiny zh" id="s-test-result" style="margin-top:10px">Key 在 Android 上写入 Keystore 加密存储，不进 SQLite、日志或导出文件。</p>

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
      <button class="btn btn-sm btn-ghost" id="s-reset">重置演示数据</button>
    </div>
    <input type="file" id="s-file" accept=".json" style="display:none" />

    <div class="sec" style="margin-top:20px"><span class="eyebrow">关于</span><hr/></div>
    <p class="tiny zh" style="margin-top:9px">模型请求直接从本机发往你配置的接入点，不经过说得出的服务器；学习数据只保存在本机。</p>`, () => {
    const readConfig = () => ({
      baseUrl: $('#s-url').value.trim(),
      apiKey: $('#s-key').value.trim() || s.apiKey,
      model: $('#s-mdl').value.trim(),
      protocol: $('#s-proto').value,
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
      await rescheduleNotifications();
      onChange?.();
    };
    $('#s-save').addEventListener('click', async () => {
      await persistForm();
      closeSheet();
      toast(S.isLive() ? '配置已保存' : '信息不全，继续使用演示模式');
    });
    $('#s-test').addEventListener('click', async () => {
      const config = readConfig();
      if (!config.baseUrl || !config.apiKey || !config.model) { toast('接入点、Key、模型都要填'); return; }
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
      r.onload = () => { try { S.importJSON(r.result); closeSheet(); toast('导入成功'); go('home'); } catch (err) { toast('导入失败：' + err.message); } };
      r.readAsText(f);
    });
    $('#s-reset').addEventListener('click', async () => {
      if (!confirm('清空本机数据并恢复演示数据？')) return;
      await S.resetAll();
      location.reload();
    });
  });
}
