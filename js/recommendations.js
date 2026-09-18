import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import {
  $,
  esc,
  skel,
  thinking,
  toast,
} from './ui.js';
import {
  bindTodayModeControls,
  drillCard,
  go,
  setTodayMode,
  todayModeHTML,
} from './views.js';
import { profileSheet } from './views2.js';
import {
  recommendationProgress,
  selectRemainingRecommendation,
} from '../src/core/recommendations.ts';

let generationPromise = null;

function itemForRecommendation(recommendation) {
  const linked = recommendation.collectedItemId
    ? S.getItem(recommendation.collectedItemId)
    : null;
  if (linked) return linked;

  return S.findItemBySkeleton(
    recommendation.skeleton,
    recommendation.kind,
  ) || null;
}

function syncPracticedCards(deck) {
  let current = deck;
  for (const recommendation of deck.items) {
    if (recommendation.practicedAt > 0) continue;
    const item = itemForRecommendation(recommendation);
    const practiced = item?.history
      ?.filter(entry => Number(entry.at) >= deck.generatedAt)
      .sort((left, right) => Number(right.at) - Number(left.at))[0];
    if (practiced) {
      current = S.markRecommendationPracticed(
        recommendation.id,
        practiced.at,
      ) || current;
    }
  }
  return current;
}

async function generateDeck() {
  if (!generationPromise) {
    generationPromise = L.recommendDaily()
      .then(result => S.saveDailyRecommendations(result.items))
      .finally(() => {
        generationPromise = null;
      });
  }
  return generationPromise;
}

function headerHTML() {
  return `<div class="page-head today-recommendation-head">
    <div class="page-head-copy">
      <h1 class="h-lg zh">今天</h1>
    </div>
    <button class="btn btn-sm btn-ghost" id="recommend-profile">学习偏好</button>
  </div>
  ${todayModeHTML('recommendation')}`;
}

function bindHeader(app) {
  bindTodayModeControls(app);
  $('#recommend-profile').addEventListener('click', profileSheet);
}

function speakerIcon() {
  return `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">
    <path d="M5 10v4h3l4 3V7L8 10H5z"/><path d="M16 9.5c1.4 1.3 1.4 3.7 0 5M18.5 7c3 2.7 3 7.3 0 10"/>
  </svg>`;
}

function arrowIcon(direction) {
  const path = direction === 'left'
    ? '<path d="m15 18-6-6 6-6"/>'
    : '<path d="m9 18 6-6-6-6"/>';
  return `<svg viewBox="0 0 24 24" class="ic" aria-hidden="true">${path}</svg>`;
}

function mountPractice(app, recommendation) {
  let item = itemForRecommendation(recommendation);
  if (item?.status === 'retired') S.revive(item.id);

  if (!item) {
    item = S.addItem({
      kind: recommendation.kind,
      skeleton: recommendation.skeleton,
      zh: recommendation.zh,
      lemma: recommendation.lemma,
      sense: recommendation.sense,
      collocations: recommendation.collocations,
      anchorSentence: recommendation.anchorSentence,
      relatedExpressionIds: recommendation.relatedExpressionIds,
      domainTags: recommendation.domainTags,
      trigger: recommendation.trigger,
      why: recommendation.why,
      register: recommendation.register,
      tags: recommendation.tags,
      seeds: [recommendation.example, recommendation.drill.answer],
      drill: {
        brief: recommendation.drill.brief,
        target_zh: recommendation.drill.target_zh,
      },
      srcKind: 'recommendation',
      raw: '',
    });
  }

  S.markRecommendationCollected(recommendation.id, item.id);
  const action = $('#recommend-practice');
  if (action) {
    action.textContent = '练习进行中';
    action.disabled = true;
  }

  const context = S.state.profile.scenarios?.[0] || '今天的真实沟通';
  const drill = drillCard(item, {
    brief: recommendation.drill.brief,
    ctx: context,
    target_zh: recommendation.drill.target_zh,
    trigger: recommendation.trigger,
  }, {
    label: recommendation.kind === 'term'
      ? '今日专业词汇 · 场景练习'
      : '今日推荐 · 深入练习',
    referenceAnswer: recommendation.drill.answer,
    sessionSource: 'recommendation',
    sessionSourceId: recommendation.id,
    onGraded: () => {
      const nextDeck = S.markRecommendationPracticed(recommendation.id);
      const progress = nextDeck
        ? recommendationProgress(nextDeck)
        : null;
      if (!progress?.remaining) {
        toast('今日推荐已完成');
        renderComplete(app, nextDeck || S.todayRecommendationDeck());
        return;
      }
      toast(`已完成，今天还剩 ${progress.remaining} 个`);
      renderDeck(app, nextDeck || S.todayRecommendationDeck());
      $('#recommend-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    },
  });
  $('.recommendation-view', app).classList.add('is-practicing');
  $('#recommend-drill').innerHTML = `<button class="btn-text recommendation-return" id="recommend-return">‹ 返回推荐表达</button>${drill.html}`;
  $('#recommend-return').addEventListener('click', () => {
    SP.stop();
    renderDeck(app, S.todayRecommendationDeck());
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  drill.mount();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('#recommend-drill').scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

function expiredPracticeContext() {
  const session = S.expiredRecommendationPracticeSession();
  if (!session) return null;

  const item = S.getItem(session.itemId);
  if (!item) return null;
  if (item.status === 'retired') S.revive(item.id);

  const recommendation = S.state.dailyRecommendations?.items?.find(
    candidate => candidate.id === session.sourceId,
  ) || null;
  return { item, recommendation, session };
}

function renderExpiredPractice(app, context) {
  const {
    item,
    recommendation,
    session,
  } = context;
  const drill = drillCard(item, {
    brief: session.cue.brief || item.drill?.brief || '',
    ctx: session.cue.context || S.state.profile.scenarios?.[0] || '',
    target_zh: session.cue.targetZh || item.drill?.target_zh || '',
    trigger: session.cue.trigger || item.trigger || '',
  }, {
    label: item.kind === 'term'
      ? '跨日恢复 · 专业词汇'
      : '跨日恢复 · 表达练习',
    referenceAnswer: recommendation?.drill?.answer || item.seeds?.[0] || '',
    sessionSource: 'recommendation',
    sessionSourceId: session.sourceId,
    onGraded: () => {
      toast('未完成练习已结算');
      const todayDeck = S.todayRecommendationDeck();
      if (todayDeck) {
        renderDeck(app, todayDeck);
        return;
      }
      renderStart(app);
    },
  });

  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <div class="recommendation-meta">
      <span class="eyebrow">继续未完成练习</span>
      <span class="sub">完成后进入今天</span>
    </div>
    <div id="recommend-drill">${drill.html}</div>
  </div>`;
  bindHeader(app);
  drill.mount();
}

function renderComplete(app, deck) {
  const progress = recommendationProgress(deck);
  const dueCount = S.dueItems().length;
  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <section class="today-finish is-all-done" role="status">
      <div class="recommendation-complete-icon" aria-hidden="true">✓</div>
      <h2 class="zh">今日推荐已完成</h2>
      <p class="zh">${dueCount
        ? `${progress.total} 个学习单元已练完，还有 ${dueCount} 条待复习。`
        : '今天的复习与推荐都已完成。'}</p>
      ${dueCount
        ? '<div class="today-finish-actions"><button class="btn btn-pri" data-today-mode="review">去复习</button><button class="btn btn-ghost" id="recommend-stop">先到这里</button></div>'
        : ''}
    </section>
  </div>`;
  bindHeader(app);
  $('#recommend-stop')?.addEventListener('click', () => toast('今天的进度已保存'));
}

function renderDeck(app, deck) {
  if (!deck?.items.length) {
    renderError(app, new Error('今天的推荐没有可用内容'));
    return;
  }

  deck = syncPracticedCards(deck);
  const selection = selectRemainingRecommendation(deck);
  if (!selection) {
    renderComplete(app, deck);
    return;
  }

  const {
    card: recommendation,
    position,
    remaining,
  } = selection;
  const existing = itemForRecommendation(recommendation);
  const progress = recommendationProgress(deck);
  const isCollected = Boolean(
    recommendation.collectedItemId
    && S.getItem(recommendation.collectedItemId),
  );
  const practiceLabel = isCollected
    ? '继续练习'
    : existing
      ? '开始练习'
      : S.weeklyTargetLeft()
        ? recommendation.kind === 'term'
          ? '加入词汇并练习'
          : '加入表达库并练习'
        : '收录并练习 · 复习顺延';
  const kindLabel = recommendation.kind === 'term' ? '专业词汇' : '表达';

  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <div class="recommendation-meta">
      <span class="eyebrow">已完成 ${progress.completed} / ${progress.total}</span>
      <span class="sub">${position + 1} / ${remaining.length}</span>
    </div>

    <article class="recommendation-card" id="recommend-card" aria-live="polite" tabindex="0">
        <div class="chips"><span class="chip ${recommendation.kind === 'term' ? 'warm' : 'acc'}">${kindLabel}</span>${recommendation.tags.map(
          tag => `<span class="chip">${esc(tag)}</span>`,
        ).join('')}</div>
      <div class="recommendation-expression">
        <p class="skel en">${skel(recommendation.skeleton)}</p>
        <button class="recommendation-say" id="recommend-say-skeleton" aria-label="朗读表达" title="朗读表达">${speakerIcon()}</button>
      </div>
      <p class="zh sub recommendation-meaning">${esc(recommendation.zh)}</p>

      ${recommendation.kind === 'term' && recommendation.collocations.length ? `<div class="recommendation-term-uses">
        <span class="eyebrow">常见搭配</span>
        <div class="chips">${recommendation.collocations.map(
          collocation => `<span class="chip">${esc(collocation)}</span>`,
        ).join('')}</div>
      </div>` : ''}

      <div class="recommendation-example">
        <div class="row" style="justify-content:space-between">
          <span class="eyebrow">例句</span>
          <button class="recommendation-say" id="recommend-say-example" aria-label="朗读例句" title="朗读例句">${speakerIcon()}</button>
        </div>
        <p class="en">${esc(recommendation.example)}</p>
        <p class="example-translation">${esc(recommendation.example_zh)}</p>
      </div>

    </article>
      <section class="recommendation-fit">
        <h2 class="eyebrow">什么时候用</h2>
        <p class="zh">${esc(recommendation.trigger)}</p>
      </section>

    <div class="recommendation-progress" aria-hidden="true">
      ${remaining.map((_, itemIndex) => `<i class="${itemIndex === position ? 'on' : ''}"></i>`).join('')}
    </div>

    <div class="recommendation-actions">
      <button class="recommendation-arrow" id="recommend-prev" aria-label="上一个推荐" title="上一个推荐" ${position === 0 ? 'disabled' : ''}>${arrowIcon('left')}</button>
      <button class="btn btn-pri grow" id="recommend-practice">${practiceLabel}</button>
      <button class="recommendation-arrow" id="recommend-next" aria-label="下一个推荐" title="下一个推荐" ${position === remaining.length - 1 ? 'disabled' : ''}>${arrowIcon('right')}</button>
    </div>
    <div id="recommend-drill"></div>
  </div>`;

  bindHeader(app);
  $('#recommend-say-skeleton').addEventListener(
    'click',
    () => SP.say(recommendation.skeleton),
  );
  $('#recommend-say-example').addEventListener(
    'click',
    () => SP.say(recommendation.example),
  );
  $('#recommend-practice').addEventListener(
    'click',
    () => mountPractice(app, recommendation),
  );

  let moving = false;
  const move = (delta) => {
    if (moving) return;
    const nextPosition = position + delta;
    if (nextPosition < 0 || nextPosition >= remaining.length) return;
    moving = true;
    const nextRecommendation = remaining[nextPosition];
    const nextIndex = deck.items.findIndex(item => (
      item.id === nextRecommendation.id
    ));
    const card = $('#recommend-card');
    for (const selector of ['#recommend-prev', '#recommend-next', '#recommend-practice']) {
      $(selector).disabled = true;
    }
    card.classList.add(delta > 0 ? 'recommendation-out-left' : 'recommendation-out-right');
    setTimeout(() => {
      if (!card.isConnected) return;
      const nextDeck = S.setRecommendationIndex(nextIndex);
      renderDeck(app, nextDeck);
    }, 150);
  };

  $('#recommend-prev').addEventListener('click', () => move(-1));
  $('#recommend-next').addEventListener('click', () => move(1));

  const card = $('#recommend-card');
  let startX = null;
  let startY = null;
  card.addEventListener('pointerdown', event => {
    startX = event.clientX;
    startY = event.clientY;
  });
  card.addEventListener('pointerup', event => {
    if (startX === null || startY === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = null;
    startY = null;
    if (Math.abs(dx) < 54 || Math.abs(dx) <= Math.abs(dy)) return;
    move(dx < 0 ? 1 : -1);
  });
  card.addEventListener('pointercancel', () => {
    startX = null;
    startY = null;
  });
}

function renderError(app, error) {
  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <div class="card rose">
      <p class="zh" style="font-weight:600">${esc(L.userMessage(error))}</p>
      <button class="btn btn-sm btn-ghost" id="recommend-retry" style="margin-top:12px">重新生成</button>
    </div>
  </div>`;
  bindHeader(app);
  $('#recommend-retry').addEventListener(
    'click',
    () => loadRecommendations(app, true),
  );
}

function renderStart(app) {
  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <section class="today-finish recommendation-start">
      <h2 class="zh">准备今天的 5 个学习单元</h2>
      <p class="zh">以表达为主；有合适内容时加入 1 个专业词汇，并在新情境中练习。</p>
      <button class="btn btn-pri" id="recommend-start">开始今日推荐</button>
    </section>
  </div>`;
  bindHeader(app);
  $('#recommend-start').addEventListener('click', () => loadRecommendations(app, true));
}

async function loadRecommendations(app, shouldGenerate = false) {
  const expiredPractice = expiredPracticeContext();
  if (expiredPractice) {
    renderExpiredPractice(app, expiredPractice);
    return;
  }

  const cached = S.todayRecommendationDeck();
  if (cached) {
    renderDeck(app, cached);
    return;
  }
  if (!shouldGenerate) {
    renderStart(app);
    return;
  }

  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    ${thinking('正在准备今天的表达')}
  </div>`;
  bindHeader(app);

  try {
    const deck = await generateDeck();
    if (location.hash !== '#recommend') return;
    renderDeck(app, deck);
  } catch (error) {
    if (location.hash !== '#recommend') return;
    renderError(app, error);
  }
}

export function viewRecommendations(app) {
  SP.stop();
  setTodayMode('recommendation');
  loadRecommendations(app);
}
