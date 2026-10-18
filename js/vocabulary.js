import * as S from './store.js';
import * as L from './llm.js';
import { go, drillCard, cueFor } from './views.js';
import { recognitionCard } from './recognition.js';
import { esc, $, $$, toast } from './ui.js';
import { goalLabel } from '../src/core/vocabulary.ts';

const materialRequests = new Map();
let pickerKind = 'term';

export function viewVocabulary(app, arg) {
  if (arg) { S.state.vocabularyView = arg; S.save(); }
  const view = S.state.vocabularyView || {};
  if (view.documentId) return renderPicker(app, view.documentId);
  if (view.itemId) return renderLearning(app, null, S.getItem(view.itemId));
  const task = S.resumeVocabularyTask(view.taskId);
  if (!task) {
    app.innerHTML = `<div class="view stack"><h1 class="h-lg">没有待学词汇</h1><button class="btn btn-pri" data-back>去导入长文本</button></div>`;
    $('[data-back]', app).onclick = () => go('source'); return;
  }
  if (S.state.vocabularyView?.taskId !== task.id) {
    S.state.vocabularyView = { taskId: task.id }; S.save();
  }
  renderLearning(app, task);
}

function renderPicker(app, documentId) {
  const document = S.getSourceDocument(documentId);
  if (!document) { go('source'); return; }
  const candidates = S.sourceCandidatesFor(documentId);
  const selected = candidates.filter(candidate => !candidate.itemId && ['recognition', 'production'].includes(candidate.selection));
  const task = [...S.state.vocabularyTasks].reverse().find(entry => entry.documentId === documentId);
  const scrollY = window.scrollY;
  app.innerHTML = `<div class="view stack" id="vocabulary-picker">
    <button class="link mute" data-back>‹ 最近来源</button>
    <div class="page-head"><div><h1 class="h-lg zh">挑选词汇</h1><p class="sub zh">${esc(document.title)} · 已分析 ${document.nextChunkIndex}/${document.chunkCount} 段</p></div></div>
    <p class="tiny zh">${document.status === 'processing' ? '提炼仍在继续，可先挑选已找到的内容。' : document.error ? esc(document.error) : '候选可能有遗漏，可以从原文补选。'}${document.filteredCount ? ` ${document.filteredCount} 个候选未通过原文校验。` : ''}</p>
    <button class="btn-text" data-refresh>刷新候选</button>
    <div class="seg"><button data-kind="term" class="${pickerKind === 'term' ? 'on' : ''}">词汇 ${candidates.filter(c => c.kind === 'term').length}</button><button data-kind="expression" class="${pickerKind === 'expression' ? 'on' : ''}">表达 ${candidates.filter(c => c.kind === 'expression').length}</button></div>
    <div class="row"><label class="fld grow"><span>批量设置当前已选</span><select data-batch><option value="">选择目标</option><option value="recognition">看懂即可</option><option value="production">希望会用</option></select></label></div>
    <div class="vocabulary-candidates">${candidates.filter(candidate => candidate.kind === pickerKind).map(candidate => {
      const item = S.getItem(candidate.itemId);
      return `<article class="vocabulary-candidate">
        <div class="row"><div class="grow"><p class="skel en">${esc(candidate.skeleton)}</p><p class="zh sub">${esc(candidate.zh)}</p></div>
          ${item ? `<span class="chip">${item.status === 'familiar' ? '已熟悉' : '已收录'}</span>` : `<select data-select="${esc(candidate.id)}" aria-label="${esc(candidate.skeleton)}的学习目标">
            <option value="" ${!candidate.selection ? 'selected' : ''}>暂不选择</option>
            ${candidate.kind === 'term' ? `<option value="recognition" ${candidate.selection === 'recognition' ? 'selected' : ''}>看懂即可</option>` : ''}
            <option value="production" ${candidate.selection === 'production' ? 'selected' : ''}>希望会用</option>
            <option value="known" ${candidate.selection === 'known' ? 'selected' : ''}>已经熟悉</option></select>`}
        </div>
        <details><summary>${item ? goalLabel(item.learningGoal) : `建议：${goalLabel(candidate.suggestedGoal)}`} · 查看原文</summary>
          <p class="quote en">${esc(candidate.quote)}</p><p class="tiny zh">${esc(candidate.sourceTitle)}</p><p class="zh">${esc(candidate.goalReason)}</p>
          ${item ? `<button class="btn-text" data-practice="${esc(item.id)}">${item.status === 'familiar' ? '再练一下' : '现在学习'}</button>` : ''}
        </details>
      </article>`;
    }).join('') || '<p class="zh dim">还没有这一类候选，可以从原文补选。</p>'}</div>
    <details class="vocabulary-source"><summary>查看原文与补选</summary>
      <p class="tiny zh">选中原文中的词或固定短语，再点击“解释所选”。也可粘贴漏掉的词。</p>
      <div class="quote en selectable" data-source-body>${esc(document.body)}</div>
      <label class="fld"><span>所选词或固定短语</span><input data-manual value="${esc(document.manualSelection || '')}" placeholder="例如：rule out" /></label>
      <button class="btn btn-ghost" data-explain>解释所选并加入候选</button><p class="tiny zh" data-manual-status></p>
      <p class="tiny zh">${esc(document.manualError || '')}</p>
    </details>
    <div class="vocabulary-selection-footer stack">
      <p class="zh">已选 ${selected.length} 个</p>
      <button class="btn btn-pri btn-blk" data-start ${selected.length ? '' : 'disabled'}>保存并开始学习</button>
      <button class="btn btn-ghost btn-blk" data-save ${selected.length ? '' : 'disabled'}>保存所选，稍后学习</button>
      ${task && S.remainingVocabulary(task).length ? `<button class="btn-text" data-continue>继续学习 · 还有 ${S.remainingVocabulary(task).length} 个</button>` : ''}
      <p class="tiny zh" data-save-status></p>
    </div>
  </div>`;
  window.scrollTo({ top: scrollY, behavior: 'instant' });
  $('[data-back]', app).onclick = () => go('source');
  $('[data-refresh]', app).onclick = () => renderPicker(app, documentId);
  $$('[data-kind]', app).forEach(button => button.onclick = () => { pickerKind = button.dataset.kind; renderPicker(app, documentId); });
  $$('[data-select]', app).forEach(select => select.onchange = () => { S.selectSourceCandidate(select.dataset.select, select.value); renderPicker(app, documentId); });
  $('[data-batch]', app).onchange = event => {
    for (const candidate of selected) S.selectSourceCandidate(candidate.id, candidate.kind === 'term' ? event.target.value : 'production');
    renderPicker(app, documentId);
  };
  $$('[data-practice]', app).forEach(button => button.onclick = () => {
    const item = S.getItem(button.dataset.practice);
    if (item.status === 'retired') S.revive(item.id);
    if (item.status === 'familiar') S.restartRecognition(item.id);
    go('vocabulary', { itemId: item.id });
  });
  let selectedQuote = document.manualQuote || '';
  $('[data-source-body]', app).addEventListener('mouseup', captureSelection);
  $('[data-source-body]', app).addEventListener('touchend', captureSelection);
  function captureSelection() {
    const selection = window.getSelection();
    if (!selection?.toString().trim() || !selection.anchorNode || !$('[data-source-body]', app).contains(selection.anchorNode)) return;
    const text = selection.toString().trim();
    if (text.split(/\s+/).length > 8) return;
    $('[data-manual]', app).value = text;
    document.manualSelection = text;
    const range = selection.getRangeAt(0);
    const prefix = range.cloneRange();
    prefix.selectNodeContents($('[data-source-body]', app));
    prefix.setEnd(range.startContainer, range.startOffset);
    const offset = prefix.toString().length;
    const left = document.body.slice(0, offset).search(/[^.!?\n]*$/u);
    const rightMatch = document.body.slice(offset + text.length).search(/[.!?\n]/u);
    const right = rightMatch < 0 ? document.body.length : offset + text.length + rightMatch + 1;
    selectedQuote = document.body.slice(Math.max(0, left), right).trim();
    document.manualQuote = selectedQuote;
    S.save();
  }
  $('[data-manual]', app).oninput = event => {
    document.manualSelection = event.target.value; document.manualQuote = ''; selectedQuote = ''; S.save();
  };
  $('[data-explain]', app).onclick = async event => {
    const button = event.currentTarget;
    const selectedText = $('[data-manual]', app).value.trim();
    const sentences = document.body.match(/[^.!?\n]+[.!?]?/gu) || [];
    const quote = selectedQuote || sentences.find(sentence => sentence.toLowerCase().includes(selectedText.toLowerCase()))?.trim();
    if (!selectedText || !quote) { $('[data-manual-status]', app).textContent = '请先选择原文中出现的词或短语'; return; }
    document.manualSelection = selectedText; S.save(); button.disabled = true;
    document.manualError = ''; S.save();
    $('[data-manual-status]', app).textContent = '正在确认原文义项…';
    try {
      const candidate = await L.explainSelectedVocabulary(selectedText, quote);
      S.addManualSourceCandidate(documentId, candidate); await S.flush();
      document.manualSelection = ''; document.manualQuote = ''; S.save();
      if (button.isConnected) renderPicker(app, documentId);
    } catch (error) {
      document.manualError = `${L.userMessage(error)}；所选词已保留，可以重试。`; S.save();
      if (button.isConnected) $('[data-manual-status]', app).textContent = document.manualError;
    } finally { button.disabled = false; }
  };
  let saving = false;
  for (const action of ['start', 'save']) {
    $(`[data-${action}]`, app).onclick = async () => {
      if (saving) return; saving = true;
      $('[data-start]', app).disabled = true; $('[data-save]', app).disabled = true;
      try {
        const saved = await S.saveVocabularySelection(documentId);
        if (!saved) return;
        if (!app.querySelector('#vocabulary-picker') || S.state.vocabularyView?.documentId !== documentId) return;
        if (action === 'start') go('vocabulary', { taskId: saved.id });
        else { toast('已保存，可以稍后继续学习'); renderPicker(app, documentId); }
      } catch (error) {
        if ($('[data-save-status]', app)) {
          $('[data-save-status]', app).textContent = error instanceof Error ? error.message : String(error);
          $('[data-start]', app).disabled = false; $('[data-save]', app).disabled = false;
        }
      } finally { saving = false; }
    };
  }
  $('[data-continue]', app)?.addEventListener('click', () => go('vocabulary', { taskId: task.id }));
}

async function prepare(item) {
  const key = `${item.id}:${item.goalRevision || 0}:${item.learningGoal || 'production'}`;
  if (materialRequests.has(key)) return materialRequests.get(key);
  const revision = item.goalRevision || 0;
  item.materialStatus = 'preparing'; S.save();
  const promise = L.prepareVocabularyMaterial(item).then(material => {
    S.setVocabularyMaterial(item.id, material, revision);
  }).catch(error => {
    if ((S.getItem(item.id)?.goalRevision || 0) === revision) {
      item.materialStatus = 'pending'; item.materialError = L.userMessage(error); S.save();
    }
  }).finally(() => materialRequests.delete(key));
  materialRequests.set(key, promise); return promise;
}

function renderLearning(app, task, singleItem) {
  const group = task ? task.groupIds.filter(id => S.remainingVocabulary(task).includes(id)) : [];
  const item = singleItem || S.getItem(group[0]);
  if (!item) {
    app.innerHTML = `<div class="view stack"><h1 class="h-lg zh">本组学习完成了</h1>
      <p class="zh">${task && S.remainingVocabulary(task).length ? `还有 ${S.remainingVocabulary(task).length} 个待学。` : '后续复习会按学习目标回到今天。'}</p>
      ${task && S.remainingVocabulary(task).length ? '<button class="btn btn-pri" data-more>开始下一组</button>' : ''}
      <button class="btn btn-ghost" data-stop>先到这里</button></div>`;
    $('[data-more]', app)?.addEventListener('click', () => { task.groupIds = []; S.resumeVocabularyTask(task.id); renderLearning(app, task); });
    $('[data-stop]', app).onclick = () => go('home'); return;
  }
  const viewAtStart = S.state.vocabularyView;
  app.innerHTML = `<div class="view stack">
    <div class="page-head"><div><h1 class="h-lg zh">学习词汇</h1><p class="sub zh">${task ? `${esc(task.title)} · 本组 ${task.groupIds.length - group.length + 1}/${task.groupIds.length}` : '临时加练'}</p></div><button class="btn-text" data-stop>先到这里</button></div>
    ${item.kind === 'term' ? `<label class="fld"><span>学习目标</span><select data-goal><option value="recognition" ${item.learningGoal === 'recognition' ? 'selected' : ''}>看懂即可</option><option value="production" ${item.learningGoal !== 'recognition' ? 'selected' : ''}>希望会用</option></select></label>` : ''}
    <div data-learning></div>
  </div>`;
  $('[data-stop]', app).onclick = () => { if (task) { task.paused = true; S.save(); } go('home'); };
  $('[data-goal]', app)?.addEventListener('change', event => { S.setLearningGoal(item.id, event.target.value); renderLearning(app, task, singleItem); });
  const slot = $('[data-learning]', app);
  const done = () => {
    if (task) { S.completeVocabularyItem(task.id, item.id); renderLearning(app, task); }
    else go('home');
  };
  const materialReady = item.vocabularyMaterial
    && (item.learningGoal === 'recognition' || item.vocabularyMaterial.drill);
  if (!materialReady && (item.materialStatus !== 'ready' || item.learningGoal === 'recognition')) {
    slot.innerHTML = `<section class="card stack"><p class="skel en">${esc(item.skeleton)}</p><p class="zh">${esc(item.zh)}</p>
      <p class="zh dim">${esc(item.materialError || '词汇已保存，准备好学习材料后即可开始。')}</p>
      <button class="btn btn-pri" data-prepare ${item.materialStatus === 'preparing' ? 'disabled' : ''}>${item.materialStatus === 'preparing' ? '正在准备…' : '准备学习材料'}</button></section>`;
    const button = $('[data-prepare]', app);
    const run = async () => {
      button.disabled = true; button.textContent = '正在准备…';
      await prepare(item); await S.flush();
      if (button.isConnected && S.state.vocabularyView === viewAtStart) renderLearning(app, task, singleItem);
    };
    button.onclick = run;
    if (!item.materialError) run();
    return;
  }
  const card = item.learningGoal === 'recognition'
    ? recognitionCard(item, { sourceId: task?.id || 'library', onDone: done })
    : drillCard(item, cueFor(item), { label: '练习使用', sessionSource: 'vocabulary',
      sessionSourceId: task?.id || item.id, onGraded: done });
  slot.innerHTML = card.html; card.mount();
}
