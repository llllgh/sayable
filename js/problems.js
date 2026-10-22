import * as S from './store.js';
import * as L from './llm.js';
import { $, $$, esc, ago, toast, thinking } from './ui.js';
import { drillCard, go } from './views.js';
import { PROBLEM_CATEGORIES } from '../src/core/expression-problems.ts';

function evidenceHTML(entry) {
  return `<details class="problem-evidence" data-evidence="${esc(entry.id)}">
    <summary><span>${esc(entry.quote)}</span><small>${ago(entry.at)} · ${entry.ignored ? '已忽略' : entry.confirmed ? '已确认' : '待确认'}</small></summary>
    <div class="stack">
      <p class="tiny zh">原题：${esc(entry.brief || entry.targetZh || '当时的表达练习')}</p>
      <p class="en">${esc(entry.answer)}</p>
      <p class="zh">${esc(entry.reason)}</p>
      ${entry.kind === 'optional' ? '<p class="tiny zh">原句可接受，以下仅为可选精简。</p>'
        : entry.kind === 'target' ? '<p class="tiny zh">这是目标表达的调用记录，不代表语言错误。</p>' : ''}
      ${entry.suggestion ? `<div class="problem-suggestion"><span class="eyebrow">${entry.kind === 'optional' ? '可选版本' : '当时的修正版'}</span><p class="en">${esc(entry.suggestion)}</p></div>` : ''}
      <label class="problem-category"><span>归类</span><select aria-label="修改反馈归类" data-reclassify="${esc(entry.id)}">
        ${PROBLEM_CATEGORIES.map(category => `<option value="${category.id}" ${entry.category === category.id ? 'selected' : ''}>${category.label}</option>`).join('')}
      </select></label>
      <div class="row wrap">
        <button class="btn btn-sm btn-ghost" data-confirm-evidence="${esc(entry.id)}">${entry.ignored ? '恢复并确认' : '确认这条反馈'}</button>
        ${!entry.ignored ? `<button class="btn-text" data-ignore-evidence="${esc(entry.id)}">忽略</button>` : ''}
      </div>
    </div>
  </details>`;
}

export function viewProblems(app) {
  const expanded = new Set($$('details[open][data-evidence]', app).map(node => node.dataset.evidence));
  const groups = S.expressionProblems();
  const all = S.expressionProblemEvidence();
  const listed = new Set(groups.flatMap(group => group.entries.map(entry => entry.id)));
  const single = all.filter(entry => !entry.ignored && !listed.has(entry.id));
  const ignored = all.filter(entry => entry.ignored);
  const pending = S.pendingProblemPractice();
  app.innerHTML = `<div class="view stack problems-view">
    <div class="page-head"><div class="page-head-copy"><h1 class="h-lg zh">表达问题档案</h1></div>
      <button class="btn btn-sm btn-ghost" data-problem-back>表达库</button></div>
    <p class="dim zh">来自最近保留的练习首答。同类至少出现在两次不同练习中，才列为重复反馈。</p>
    ${pending ? '<button class="btn btn-ghost btn-blk" data-problem-continue>继续针对性练习</button>' : ''}
    ${groups.length ? groups.map(group => `<section class="problem-group" data-problem="${group.id}">
      <div class="row"><h2 class="h-md zh grow">${group.label}</h2><span class="chip">${group.trainable ? '已确认' : '待确认'}</span></div>
      <p class="tiny zh">${group.count} 次不同练习 · 最近${ago(group.latestAt)}${group.completedCount ? ` · 已完成 ${group.completedCount} 次针对性练习` : ''}</p>
      ${group.entries.map(evidenceHTML).join('')}
      <div class="problem-group-actions">
        ${group.entries.some(entry => !entry.confirmed) ? `<button class="btn btn-ghost" data-confirm-group="${group.id}">确认当前证据</button>` : ''}
        <button class="btn btn-pri" data-train-problem="${group.id}" ${!group.trainable || (pending && pending.status !== 'error') || !S.problemPracticeItem(group) ? 'disabled' : ''}>开始针对性练习</button>
      </div>
      ${group.trainable && !S.problemPracticeItem(group) ? '<p class="tiny zh">相关表达已归档或改为“看懂即可”，暂时无法练习；证据仍可回看。</p>' : ''}
    </section>`).join('') : `<section class="today-finish">
      <h2>${all.length ? '还没有重复反馈' : '先积累真实练习'}</h2>
      <p>${all.length ? '已有的单次反馈可以先查看和确认。' : '完成表达练习后，有证据的反馈会在这里积累。离线自评、查看答案和重答不增加问题次数。'}</p>
      <button class="btn btn-pri" data-problem-today>去今天练习</button>
    </section>`}
    ${single.length ? `<details class="result-details"><summary>尚未重复的反馈 · ${single.length} 条</summary>${single.map(evidenceHTML).join('')}</details>` : ''}
    ${ignored.length ? `<details class="result-details"><summary>已忽略 · ${ignored.length} 条</summary>${ignored.map(evidenceHTML).join('')}</details>` : ''}
  </div>`;
  $$('[data-evidence]', app).forEach(node => {
    if (expanded.has(node.dataset.evidence)) { node.open = true; const parent = node.parentElement.closest('details'); if (parent) parent.open = true; }
  });
  $('[data-problem-back]', app).addEventListener('click', () => go('library'));
  $('[data-problem-today]', app)?.addEventListener('click', () => go('home'));
  $('[data-problem-continue]', app)?.addEventListener('click', () => go('problem-practice'));
  $$('[data-confirm-group]', app).forEach(button => button.addEventListener('click', () => {
    S.confirmExpressionProblem(button.dataset.confirmGroup); viewProblems(app);
  }));
  const decide = (id, action, category) => {
    const entry = all.find(entry => entry.id === id);
    S.decideExpressionProblem(id, action, category || entry.category); viewProblems(app);
  };
  $$('[data-confirm-evidence]', app).forEach(button => button.addEventListener('click',
    () => decide(button.dataset.confirmEvidence, 'confirm')));
  $$('[data-ignore-evidence]', app).forEach(button => button.addEventListener('click',
    () => decide(button.dataset.ignoreEvidence, 'ignore')));
  $$('[data-reclassify]', app).forEach(select => select.addEventListener('change',
    () => decide(select.dataset.reclassify, 'confirm', select.value)));
  $$('[data-train-problem]', app).forEach(button => button.addEventListener('click',
    () => generatePractice(app, button.dataset.trainProblem)));
}

async function generatePractice(app, category) {
  let started;
  try {
    started = S.beginProblemPractice(category);
  } catch (error) {
    toast(error.message); return;
  }
  go('problem-practice');
  if (!started.request) return;
  const { task, item, group, evidence } = started;
  try {
    if (!S.isLive()) throw new Error('请先在设置中配置模型服务，再重试出题');
    if (!navigator.onLine) throw new Error('当前离线，联网后可重试出题');
    const drill = await L.regenerateReviewCue(item, { label: group.label, focus: group.focus, evidence });
    S.completeProblemPracticeCue(task.requestId, drill);
  } catch (error) {
    S.failProblemPracticeCue(task.requestId, L.userMessage(error));
  }
  if (app.dataset.route === 'problem-practice' && app.querySelector('[data-pending-task]')?.dataset.pendingTask === task.id) {
    viewProblemPractice(app);
  }
}

export function viewProblemPractice(app) {
  const task = S.pendingProblemPractice();
  const session = task ? S.getPracticeSession(task.sessionId) : null;
  const finished = !task && S.getPracticeSession(S.state.problemPractice?.sessionId);
  const completedOutput = finished?.completedAt
    && finished.attempts.some(attempt => attempt.status === 'judged' && attempt.kind !== 'reveal');
  const category = PROBLEM_CATEGORIES.find(category => category.id === task?.category);
  app.innerHTML = `<div class="view stack" ${task ? `data-pending-task="${task.id}"` : ''}>
    <div class="page-head"><div class="page-head-copy"><h1 class="h-lg zh">针对性练习</h1>
      ${category ? `<p class="dim zh">${category.label}</p>` : ''}</div>
      <button class="btn btn-sm btn-ghost" data-problem-back>返回档案</button></div>
    <div id="problem-practice-card">${!task ? `<section class="today-finish"><h2>${completedOutput
      ? '本次练习已完成' : finished?.completedAt ? '已查看这道题的答案' : '先选择要练习的问题'}</h2><p>${completedOutput
      ? '完成次数已记录。之后仍需在新场景中持续练习。'
      : finished?.completedAt ? '查看答案不计为完成针对性练习。可以返回档案，换一个新场景再试。'
      : '返回档案，确认重复反馈后开始一次新场景练习。'}</p></section>`
      : task.status === 'generating' ? `${thinking('正在准备新的练习场景')}<p class="tiny zh">可以先离开，题目准备好后会保留。</p>`
      : task.status === 'error' || !session ? `<section class="card"><p class="zh">${esc(task.error || '这次练习记录已不可用，请重新出题')}</p>
        <button class="btn btn-pri" data-problem-retry>重试出题</button></section>` : ''}</div>
  </div>`;
  $('[data-problem-back]', app).addEventListener('click', () => go('problems'));
  $('[data-problem-retry]', app)?.addEventListener('click', () => generatePractice(app, task.category));
  if (task?.status !== 'ready' || !session) return;
  const item = S.getItem(session.itemId);
  if (!item || item.status === 'retired' || item.learningGoal === 'recognition'
    || (item.goalRevision || 0) !== session.goalRevision) {
    $('#problem-practice-card', app).innerHTML = '<p class="zh">学习条目或目标已变化，这道题不再适用。</p><button class="btn btn-ghost" data-problem-dismiss>返回选择</button>';
    $('[data-problem-dismiss]', app).addEventListener('click', () => {
      S.leaveProblemPractice(); go('problems');
    });
    return;
  }
  const drill = drillCard(item, {
    brief: session.cue.brief, ctx: session.cue.context,
    target_zh: session.cue.targetZh, trigger: session.cue.trigger,
  }, {
    label: `针对性练习 · ${category.label}`, sessionId: session.id,
    sessionSource: 'problem-practice', sessionSourceId: task.id,
    onGraded: () => viewProblemPractice(app),
  });
  $('#problem-practice-card', app).innerHTML = drill.html;
  drill.mount();
}
