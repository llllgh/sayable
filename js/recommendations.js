import * as S from './store.js';
import * as L from './llm.js';
import * as SP from './speech.js';
import {
  $,
  $$,
  closeSheet,
  esc,
  openSheet,
  skel,
  thinking,
  toast,
} from './ui.js';
import { drillCard } from './views.js';
import { recommendationKey } from '../src/core/recommendations.ts';

let generationPromise = null;

function itemForRecommendation(recommendation) {
  const linked = recommendation.collectedItemId
    ? S.getItem(recommendation.collectedItemId)
    : null;
  if (linked) return linked;

  const key = recommendationKey(recommendation.skeleton);
  return S.state.items.find(
    item => recommendationKey(item.skeleton) === key,
  ) || null;
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
  return `<div class="row" style="align-items:flex-start">
    <div class="grow">
      <h1 class="h-lg zh">今日推荐</h1>
      <p class="sub zh" style="margin-top:6px">从你的工作语境和过往表达里，挑一张今天值得练的。</p>
    </div>
    <button class="btn btn-sm btn-ghost" id="recommend-profile">调整画像</button>
  </div>`;
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

function openBudgetSwap(recommendation, onReady) {
  const candidates = S.newItemsThisWeek();
  if (!candidates.length) {
    toast('本周收编名额已满');
    return;
  }

  openSheet(
    '替换本周的一条',
    `${candidates.map(item => `<button class="btn btn-blk btn-ghost recommendation-swap" data-replace="${item.id}">
      <span><span class="skel en" style="font-size:14.5px">${skel(item.skeleton)}</span><br/>
      <span class="tiny zh">真实用过 ${item.usedReal.length} 次 · 我造过 ${item.mine.length} 句</span></span>
    </button>`).join('')}
    <p class="tiny zh" style="margin-top:10px">被替换的表达保留历史，但不再进入复习队列。</p>`,
    body => {
      $$('[data-replace]', body).forEach(button => button.addEventListener(
        'click',
        () => {
          S.retire(button.dataset.replace);
          closeSheet();
          onReady(recommendation);
        },
      ));
    },
  );
}

function mountPractice(app, recommendation) {
  let item = itemForRecommendation(recommendation);
  if (item?.status === 'retired') S.revive(item.id);

  if (!item) {
    if (!S.budgetLeft()) {
      openBudgetSwap(recommendation, selected => mountPractice(app, selected));
      return;
    }
    item = S.addItem({
      skeleton: recommendation.skeleton,
      zh: recommendation.zh,
      why: recommendation.why,
      register: recommendation.register,
      tags: recommendation.tags,
      seeds: [recommendation.example],
      srcKind: 'recommendation',
      raw: '',
    });
  }

  S.markRecommendationCollected(recommendation.id, item.id);
  const action = $('#recommend-practice');
  if (action) action.textContent = '已收编 · 正在练习';
  const collected = S.todayRecommendationDeck()?.items.filter(card => (
    card.collectedItemId && S.getItem(card.collectedItemId)
  )).length || 0;
  const collectedChip = $('#recommend-collected');
  if (collectedChip) {
    collectedChip.textContent = `已收编 ${collected} / ${S.todayRecommendationDeck()?.items.length || 0}`;
    collectedChip.classList.add('acc');
  }

  const context = S.state.profile.scenarios?.[0] || '今天的真实沟通';
  const drill = drillCard(item, {
    brief: recommendation.drill,
    ctx: context,
    target_zh: recommendation.zh,
  }, {
    label: '今日推荐 · 深入练习',
    onGraded: () => {
      toast('已进入复习队列');
      renderDeck(app, S.todayRecommendationDeck());
      $('#recommend-card')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    },
  });
  $('#recommend-drill').innerHTML = drill.html;
  drill.mount();
  $('#recommend-drill').scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

function renderDeck(app, deck) {
  if (!deck?.items.length) {
    renderError(app, new Error('今天的推荐没有可用内容'));
    return;
  }

  const index = Math.max(
    0,
    Math.min(deck.items.length - 1, deck.currentIndex),
  );
  const recommendation = deck.items[index];
  const existing = itemForRecommendation(recommendation);
  const collectedCount = deck.items.filter(item => (
    item.collectedItemId && S.getItem(item.collectedItemId)
  )).length;

  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    <div class="recommendation-meta">
      <span class="eyebrow" style="color:var(--warm)">今日抽卡</span>
      <span class="chip ${collectedCount ? 'acc' : ''}" id="recommend-collected">已收编 ${collectedCount} / ${deck.items.length}</span>
    </div>

    <article class="recommendation-card" id="recommend-card" aria-live="polite" tabindex="0">
      <div class="row" style="justify-content:space-between">
        <span class="chip">${index + 1} / ${deck.items.length}</span>
        <div class="chips">${recommendation.tags.map(
          tag => `<span class="chip">${esc(tag)}</span>`,
        ).join('')}</div>
      </div>
      <div class="recommendation-expression">
        <p class="skel en">${skel(recommendation.skeleton)}</p>
        <button class="recommendation-say" id="recommend-say-skeleton" aria-label="朗读表达" title="朗读表达">${speakerIcon()}</button>
      </div>
      <p class="zh sub recommendation-meaning">${esc(recommendation.zh)}</p>

      <div class="recommendation-example">
        <div class="row" style="justify-content:space-between">
          <span class="eyebrow">例句</span>
          <button class="recommendation-say" id="recommend-say-example" aria-label="朗读例句" title="朗读例句">${speakerIcon()}</button>
        </div>
        <p class="en">${esc(recommendation.example)}</p>
      </div>

      <div class="recommendation-fit">
        <span class="eyebrow">为什么是这张</span>
        <p class="zh">${esc(recommendation.why)}</p>
      </div>
    </article>

    <div class="recommendation-progress" aria-hidden="true">
      ${deck.items.map((_, itemIndex) => `<i class="${itemIndex === index ? 'on' : ''}"></i>`).join('')}
    </div>

    <div class="recommendation-actions">
      <button class="recommendation-arrow" id="recommend-prev" aria-label="上一个推荐" title="上一个推荐" ${index === 0 ? 'disabled' : ''}>${arrowIcon('left')}</button>
      <button class="btn btn-pri grow" id="recommend-practice">${existing ? '继续深入练习' : (S.budgetLeft() ? '收编并深入练习' : '替换一条并收编')}</button>
      <button class="recommendation-arrow" id="recommend-next" aria-label="下一个推荐" title="下一个推荐" ${index === deck.items.length - 1 ? 'disabled' : ''}>${arrowIcon('right')}</button>
    </div>
    <div id="recommend-drill"></div>
  </div>`;

  $('#recommend-profile').addEventListener(
    'click',
    () => $('#btn-profile')?.click(),
  );
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

  const move = (delta) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= deck.items.length) return;
    const card = $('#recommend-card');
    card.classList.add(delta > 0 ? 'recommendation-out-left' : 'recommendation-out-right');
    setTimeout(() => {
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
  $('#recommend-profile').addEventListener(
    'click',
    () => $('#btn-profile')?.click(),
  );
  $('#recommend-retry').addEventListener(
    'click',
    () => loadRecommendations(app),
  );
}

async function loadRecommendations(app) {
  const cached = S.todayRecommendationDeck();
  if (cached) {
    renderDeck(app, cached);
    return;
  }

  app.innerHTML = `<div class="view stack recommendation-view">
    ${headerHTML()}
    ${thinking('正在从你的场景里挑选今天的表达')}
  </div>`;
  $('#recommend-profile').addEventListener(
    'click',
    () => $('#btn-profile')?.click(),
  );

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
  loadRecommendations(app);
}
