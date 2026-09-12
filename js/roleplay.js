import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import {
  $,
  esc,
  inWords,
  openSheet,
  closeSheet,
  skel,
  thinking,
  toast,
} from './ui.js';
import {
  roleplayCommunicationPassed,
  roleplayEligibility,
  roleplayPhase,
  roleplayTargetSucceeded,
} from '../src/core/roleplay.ts';
import { isOnline } from '../src/platform/network.ts';

let pendingSessionId = '';

export function canStartRoleplay(item) {
  return roleplayEligibility(item, {
    modelReady: S.isLive(),
    online: isOnline(),
  });
}

function leaveRoleplay(route = 'library') {
  SP.stop();
  location.hash = `#${route}`;
}

function roleplayRouteActive(itemId) {
  return location.hash === `#roleplay/${encodeURIComponent(itemId)}`;
}

function roleplayErrorHTML(error, retryAction) {
  return `<div class="card rose">
    <p class="zh" style="font-weight:650">${esc(L.userMessage(error))}</p>
    <p class="tiny zh" style="margin-top:7px">已提交的回答会保留；本次失败不会推进复习阶梯。</p>
    <div class="row wrap" style="margin-top:12px">
      <button class="btn btn-pri grow" id="rp-retry">${esc(retryAction)}</button>
      <button class="btn btn-ghost" id="rp-fallback">改做普通复习</button>
    </div>
  </div>`;
}

function transcriptHTML(session) {
  return session.turns.map(turn => `<div class="roleplay-turn ${turn.speaker}">
    <span>${turn.speaker === 'ai' ? esc(session.role) : '你'}</span>
    <p class="en">${esc(turn.text)}</p>
  </div>`).join('');
}

function resultHTML(item, session) {
  const result = session.result;
  const communicationPassed = roleplayCommunicationPassed(result);
  const targetSucceeded = roleplayTargetSucceeded(result);
  const issueText = result.issueLevel === 'blocking'
    ? '有影响理解的问题'
    : result.issueLevel === 'minor'
      ? '有局部小错'
      : '表达正确';
  return `<div class="stack">
    <div class="card ${communicationPassed ? 'acc' : 'rose'}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="eyebrow">${communicationPassed ? '沟通完成' : '需要再练'}</div>
          <p class="zh" style="margin-top:7px;font-weight:650">${esc(result.verdict)}</p>
        </div>
        <span class="chip ${targetSucceeded ? 'acc' : 'warm'}">${targetSucceeded ? '目标表达已调用' : '目标表达未调用'}</span>
      </div>
      ${result.note ? `<p class="tiny zh" style="margin-top:9px">${esc(result.note)}</p>` : ''}
    </div>

    <div class="roleplay-score">
      <div><span>抓住时机</span><b>${result.triggerRecognized ? '是' : '否'}</b></div>
      <div><span>完成意图</span><b>${result.intentAchieved ? '是' : '否'}</b></div>
      <div><span>正确</span><b>${issueText}</b></div>
      <div><span>清晰</span><b>${result.clear ? '是' : '否'}</b></div>
      <div><span>简洁</span><b>${result.concise ? '是' : '可压缩'}</b></div>
      <div><span>目标骨架</span><b>${result.usedTarget ? '已使用' : '未使用'}</b></div>
    </div>

    ${result.fix ? `<div class="card"><div class="eyebrow">需要调整</div><p class="en" style="margin-top:7px">${esc(result.fix)}</p></div>` : ''}
    ${result.tighter ? `<div class="card"><div class="eyebrow">更紧说法</div><p class="en" style="margin-top:7px">${esc(result.tighter)}</p></div>` : ''}

    <div class="card flat">
      <div class="eyebrow">本次目标</div>
      <p class="skel en" style="margin-top:7px">${skel(item.skeleton)}</p>
      <p class="zh sub" style="margin-top:5px">${esc(item.zh)}</p>
      <p class="tiny zh" style="margin-top:8px">下次普通复习：${inWords(item.dueAt)}</p>
    </div>

    <div class="roleplay-result-actions">
      <button class="btn btn-pri" id="rp-done">完成</button>
      <button class="btn btn-ghost" id="rp-again">再练一次</button>
      <button class="btn btn-ghost" id="rp-used">记录实际使用</button>
    </div>
  </div>`;
}

function inputHTML(secondRound) {
  return `<div class="roleplay-compose">
    <textarea id="rp-answer" rows="3" placeholder="${secondRound ? '回应追问并补充具体做法' : '像真实会议一样直接回应'}"></textarea>
    <button class="mic" id="rp-mic" aria-label="开始录音" title="开始录音">
      <svg viewBox="0 0 24 24" class="ic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>
    </button>
    <button class="btn btn-pri" id="rp-send">发送</button>
  </div>`;
}

function bindInput(app, item, session) {
  const textarea = $('#rp-answer', app);
  const micButton = $('#rp-mic', app);
  let recording = false;
  const stopRecording = () => {
    recording = false;
    micButton?.classList.remove('rec');
    micButton?.setAttribute('aria-label', '开始录音');
    SP.stop();
  };

  micButton?.addEventListener('click', () => {
    if (!SP.canListen()) {
      textarea.focus();
      toast('请使用系统键盘上的语音输入');
      return;
    }
    if (recording) {
      stopRecording();
      return;
    }
    recording = true;
    micButton.classList.add('rec');
    micButton.setAttribute('aria-label', '停止录音');
    SP.listen({
      lang: 'en-US',
      onText: text => { textarea.value = text; },
      onEnd: stopRecording,
      onError: error => {
        stopRecording();
        toast(error.message);
      },
    });
  });

  $('#rp-send', app)?.addEventListener('click', async () => {
    const answer = textarea.value.trim();
    if (answer.split(/\s+/).filter(Boolean).length < 3) {
      toast('至少完整回应一句');
      return;
    }
    stopRecording();
    session = S.addRoleplayTurn(session.id, 'user', answer);
    await S.flush();
    await advanceRoleplay(app, item, session);
  });
}

async function advanceRoleplay(app, item, session) {
  const phase = roleplayPhase(session);
  if (!['awaiting_followup', 'awaiting_judgement'].includes(phase)) {
    renderSession(app, item, session);
    return;
  }
  if (pendingSessionId === session.id) return;
  pendingSessionId = session.id;
  app.innerHTML = `<div class="view stack roleplay-view">
    <button class="link mute roleplay-back" id="rp-back">‹ 暂时退出</button>
    <div class="roleplay-context"><span>${esc(session.role)}</span><p class="zh">${esc(session.scenario)}</p></div>
    <div class="roleplay-transcript">${transcriptHTML(session)}</div>
    ${thinking(phase === 'awaiting_followup' ? '对方正在回应' : '正在评估这次沟通')}
  </div>`;
  $('#rp-back', app)?.addEventListener('click', () => leaveRoleplay());
  try {
    if (phase === 'awaiting_followup') {
      const result = await L.continueRoleplay(item, session);
      session = S.addRoleplayTurn(session.id, 'ai', result.followup);
      await S.flush();
    } else {
      const result = await L.judgeRoleplay(item, session);
      session = S.completeRoleplaySession(session.id, result);
      await S.flush();
    }
    if (!roleplayRouteActive(item.id)) return;
    renderSession(app, item, session);
  } catch (error) {
    if (!roleplayRouteActive(item.id)) return;
    app.insertAdjacentHTML(
      'beforeend',
      roleplayErrorHTML(
        error,
        phase === 'awaiting_followup' ? '重试生成追问' : '重试评估',
      ),
    );
    $('#rp-retry', app)?.addEventListener('click', () => advanceRoleplay(app, item, session));
    $('#rp-fallback', app)?.addEventListener('click', () => leaveRoleplay(`drill/${item.id}`));
  } finally {
    pendingSessionId = '';
  }
}

function bindResult(app, item) {
  $('#rp-done', app)?.addEventListener('click', () => leaveRoleplay());
  $('#rp-again', app)?.addEventListener('click', () => startNewRoleplay(app, item));
  $('#rp-used', app)?.addEventListener('click', () => {
    openSheet('在哪儿用的？', `<label class="fld"><span>真实场景</span>
      <input type="text" id="rp-real-scene" placeholder="例如：客户方案评审" /></label>
      <button class="btn btn-pri btn-blk" id="rp-real-save">记下来</button>`, () => {
      $('#rp-real-save')?.addEventListener('click', () => {
        S.markUsedReal(item.id, $('#rp-real-scene').value.trim());
        closeSheet();
        toast('已记入真实使用');
      });
    });
  });
}

function renderSession(app, item, session) {
  const phase = roleplayPhase(session);
  app.innerHTML = `<div class="view stack roleplay-view">
    <button class="link mute roleplay-back" id="rp-back">‹ 暂时退出</button>
    <div class="page-head">
      <div class="page-head-copy">
        <div class="eyebrow">Level 4 · 情境对话</div>
        <h1 class="h-lg zh">${esc(session.role)}</h1>
        <p class="sub zh">${esc(session.scenario)}</p>
      </div>
      <span class="chip">${session.turns.filter(turn => turn.speaker === 'user').length} / 2</span>
    </div>
    <div class="roleplay-transcript">${transcriptHTML(session)}</div>
    ${phase === 'completed'
      ? resultHTML(item, session)
      : inputHTML(phase === 'awaiting_second_answer')}
  </div>`;
  $('#rp-back', app)?.addEventListener('click', () => leaveRoleplay());
  if (phase === 'completed') {
    bindResult(app, item);
  } else {
    bindInput(app, item, session);
  }
}

async function startNewRoleplay(app, item) {
  if (!canStartRoleplay(item)) {
    app.innerHTML = `<div class="view stack roleplay-view">
      <button class="link mute" id="rp-back">‹ 返回句库</button>
      <div class="card rose"><p class="zh" style="font-weight:650">当前不能开始情境对话</p>
        <p class="tiny zh" style="margin-top:7px">需要达到主动回忆阶段、已补充触发时机，并保持模型在线。</p></div>
    </div>`;
    $('#rp-back', app)?.addEventListener('click', () => leaveRoleplay());
    return;
  }
  app.innerHTML = `<div class="view stack roleplay-view">
    <button class="link mute" id="rp-back">‹ 返回句库</button>
    ${thinking('正在准备一个新情境')}
  </div>`;
  $('#rp-back', app)?.addEventListener('click', () => leaveRoleplay());
  try {
    const opening = await L.startRoleplay(item);
    const session = S.createRoleplaySession(item.id, opening);
    await S.flush();
    if (!roleplayRouteActive(item.id)) return;
    renderSession(app, item, session);
  } catch (error) {
    if (!roleplayRouteActive(item.id)) return;
    app.innerHTML = `<div class="view stack roleplay-view">
      <button class="link mute" id="rp-back">‹ 返回句库</button>
      ${roleplayErrorHTML(error, '重新生成情境')}
    </div>`;
    $('#rp-back', app)?.addEventListener('click', () => leaveRoleplay());
    $('#rp-retry', app)?.addEventListener('click', () => startNewRoleplay(app, item));
    $('#rp-fallback', app)?.addEventListener('click', () => leaveRoleplay(`drill/${item.id}`));
  }
}

export function viewRoleplay(app, itemId) {
  const item = S.getItem(itemId);
  if (!item) {
    app.innerHTML = '<div class="view"><div class="card rose"><p class="zh">找不到要练习的表达。</p></div></div>';
    return;
  }
  const session = S.activeRoleplaySession(item.id);
  if (session) {
    const phase = roleplayPhase(session);
    if (['awaiting_followup', 'awaiting_judgement'].includes(phase)) {
      advanceRoleplay(app, item, session);
    } else {
      renderSession(app, item, session);
    }
    return;
  }
  startNewRoleplay(app, item);
}
