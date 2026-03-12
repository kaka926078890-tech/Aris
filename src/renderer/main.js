import { createScene } from '../engine/scene.js';
import { getAudioAnalyser, connectTestOscillator, getFrequencyData } from '../audio/waveform.js';

const container = document.getElementById('canvas-container');
const overlay = document.getElementById('dialogue-overlay');
const bubblesWrap = document.getElementById('bubbles-wrap');
const bubblesEl = document.getElementById('bubbles');
const inputEl = document.getElementById('dialogue-input');
const stopBtn = document.getElementById('dialogue-stop');

function scrollToBottom() {
  if (bubblesWrap) bubblesWrap.scrollTop = bubblesWrap.scrollHeight;
}

const MAX_BUBBLES = 8;

/** 技能名称到中文展示的映射 */
const SKILL_LABELS = {
  list_my_files: '列出目录',
  read_file: '读取文件',
  write_file: '写入文件',
  delete_file: '删除文件',
};

function stripEmotionBlock(text) {
  if (typeof text !== 'string') return '';
  let s = text.replace(/【情感摘要】[\s\S]*?强度评分[：:]\s*\d[^\n]*/g, '');
  s = s.replace(/\n*【情感摘要】[\s\S]*$/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** 移除 DSML/工具调用块；移除情感摘要/表达欲望；去掉「是否想说话:是/否」整行。返回纯文本，不解析分块。 */
function formatBubbleContent(text) {
  if (typeof text !== 'string') return '';
  let s = text;
  const dsmlTagV1 = /<\s*\/?\s*DSML\s*\|\s*[^>]*>/gi;
  const dsmlTagV2 = /<\s*\/?\s*\|\s*[\s\S]*?DSML[\s\S]*?>/gi;
  let prev;
  do {
    prev = s;
    s = s.replace(dsmlTagV1, '').replace(dsmlTagV2, '');
  } while (s !== prev);
  s = stripEmotionBlock(s);
  s = s.replace(/\n?\s*是否想说话[：:]\s*[是否]\s*\n?/g, '\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 若内容包含「情绪与想法」与「若想说话,内容」则拆成 { selfExpression, dialogueContent }，否则返回 null（整段当普通内容展示）。
 */
function parseProactiveStyleContent(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const contentLabel = /若想说话[,，]\s*内容[：:]?\s*/;
  const idx = trimmed.search(contentLabel);
  if (idx === -1) return null;
  const afterContent = trimmed.slice(idx);
  const dialogueContent = afterContent.replace(contentLabel, '').trim();
  const beforeContent = trimmed.slice(0, idx).trim();
  const emotionLabel = /^情绪与想法[：:]?\s*/;
  const selfExpression = beforeContent.replace(emotionLabel, '').trim();
  if (!selfExpression && !dialogueContent) return null;
  return { selfExpression: selfExpression || '', dialogueContent: dialogueContent || '' };
}

/** 创建「技能卡片」DOM：展示用了什么技能、参数摘要 */
function createSkillCard(name, args) {
  const label = SKILL_LABELS[name] || name;
  const card = document.createElement('div');
  card.className = 'self-start rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm w-full max-w-[85%] min-w-0 overflow-visible shadow-sm';
  let subtitle = '';
  if (name === 'list_my_files' && (args.subpath != null)) subtitle = `路径: ${args.subpath}`;
  else if (name === 'read_file' && args.relative_path) subtitle = args.relative_path;
  else if (name === 'write_file' && args.relative_path) subtitle = args.relative_path;
  else if (name === 'delete_file' && args.relative_path) subtitle = args.relative_path;
  card.innerHTML = `<span class="text-cyan-300 font-medium">使用了技能：${escapeHtml(label)}</span>${subtitle ? `<br><span class="text-cyan-200/80 text-xs break-all">${escapeHtml(subtitle)}</span>` : ''}`;
  return card;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** 根据工具结果创建目录列表的 DOM（Markdown 风格） */
function createDirectoryBlock(result) {
  const entries = result.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'self-start rounded-xl border border-slate-500/25 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-400 max-w-[85%]';
    empty.textContent = '（空目录）';
    return empty;
  }
  const wrap = document.createElement('div');
  wrap.className = 'self-start rounded-xl border border-slate-500/25 bg-slate-900/50 px-4 py-2.5 text-sm text-slate-300 max-w-[85%] font-mono text-xs overflow-x-auto overflow-y-auto bubble-scroll-inner max-h-[200px]';
  const ul = document.createElement('ul');
  ul.className = 'list-disc list-inside space-y-0.5';
  entries.forEach((e) => {
    const li = document.createElement('li');
    const name = escapeHtml(e.name || '');
    li.innerHTML = e.type === 'dir' ? `📁 ${name}/` : `📄 ${name}`;
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  return wrap;
}

/** 根据工具结果创建文件内容块（代码块风格） */
function createFileContentBlock(result) {
  const wrap = document.createElement('div');
  wrap.className = 'self-start rounded-xl border border-slate-500/25 bg-slate-900/50 px-4 py-2.5 text-sm max-w-[85%] overflow-x-auto overflow-y-auto bubble-scroll-inner max-h-[200px]';
  if (result.error) {
    wrap.classList.add('text-red-400');
    wrap.textContent = result.error;
    return wrap;
  }
  const content = result.content != null ? String(result.content) : '';
  const pre = document.createElement('pre');
  pre.className = 'whitespace-pre-wrap break-words font-mono text-xs text-slate-300 m-0 leading-snug';
  pre.textContent = content || '（空文件）';
  wrap.appendChild(pre);
  return wrap;
}

/** 根据工具结果创建写入结果摘要 */
function createWriteResultBlock(result) {
  const wrap = document.createElement('div');
  wrap.className = 'self-start rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200 max-w-[85%]';
  if (result.error) {
    wrap.classList.add('text-red-400');
    wrap.textContent = `写入失败: ${result.error}`;
    return wrap;
  }
  wrap.textContent = result.path ? `已写入: ${result.path}` : '已写入';
  return wrap;
}

/** 根据工具结果创建删除结果摘要 */
function createDeleteResultBlock(result) {
  const wrap = document.createElement('div');
  wrap.className = 'self-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 max-w-[85%]';
  if (result.error) {
    wrap.classList.add('text-red-400');
    wrap.textContent = `删除失败: ${result.error}`;
    return wrap;
  }
  wrap.textContent = result.path ? `已删除: ${result.path}` : '已删除';
  return wrap;
}

/** 根据单条 agent 动作创建卡片 + 内容块，返回 [cardEl, contentEl?] */
function createBlocksForAction(action) {
  const { name, args, result } = action;
  const card = createSkillCard(name, args || {});
  const blocks = [card];
  if (name === 'list_my_files' && result && !result.error) {
    blocks.push(createDirectoryBlock(result));
  } else if (name === 'read_file' && result) {
    blocks.push(createFileContentBlock(result));
  } else if (name === 'write_file' && result) {
    blocks.push(createWriteResultBlock(result));
  } else if (name === 'delete_file' && result) {
    blocks.push(createDeleteResultBlock(result));
  }
  return blocks;
}

function trimToMaxBubbles() {
  while (bubblesEl.children.length > MAX_BUBBLES) {
    bubblesEl.removeChild(bubblesEl.firstChild);
  }
}

const COPY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function makeCopyButton(contentEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bubble-copy';
  btn.setAttribute('aria-label', '复制');
  btn.innerHTML = COPY_ICON_SVG;
  btn.addEventListener('click', () => {
    const text = (contentEl.textContent || '').trim();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = CHECK_ICON_SVG;
      btn.setAttribute('aria-label', '已复制');
      setTimeout(() => {
        btn.innerHTML = COPY_ICON_SVG;
        btn.setAttribute('aria-label', '复制');
      }, 1200);
    }).catch(() => {});
  });
  return btn;
}

function addBubble(role, content) {
  const row = document.createElement('div');
  row.className = role === 'user' ? 'bubble-row user-msg' : 'bubble-row assistant-msg';
  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-2 min-w-0 flex-1';
  if (role === 'user') {
    const div = document.createElement('div');
    div.className = 'bg-cyan-500/15 border border-cyan-400/30 rounded-xl px-4 py-2.5 text-sm text-cyan-50 min-w-0 overflow-hidden transition-opacity duration-300 bubble-content shadow-sm';
    div.textContent = formatBubbleContent(content);
    wrapper.appendChild(div);
  } else {
    const formatted = formatBubbleContent(content);
    const parsed = parseProactiveStyleContent(formatted);
    if (parsed && (parsed.selfExpression || parsed.dialogueContent)) {
      if (parsed.selfExpression) {
        const selfBlock = document.createElement('div');
        selfBlock.className = 'bubble-self-expression rounded-lg border border-slate-500/20 bg-slate-800/50 px-3 py-2 text-xs text-slate-400 min-w-0 overflow-hidden bubble-content';
        selfBlock.textContent = parsed.selfExpression;
        wrapper.appendChild(selfBlock);
      }
      if (parsed.dialogueContent) {
        const mainBlock = document.createElement('div');
        mainBlock.className = 'bg-slate-900/70 border border-cyan-500/20 rounded-xl px-4 py-2.5 text-sm text-slate-100 min-w-0 overflow-hidden transition-opacity duration-300 bubble-content shadow-md shadow-black/20';
        mainBlock.textContent = parsed.dialogueContent;
        wrapper.appendChild(mainBlock);
        row.appendChild(wrapper);
        row.appendChild(makeCopyButton(wrapper));
        bubblesEl.appendChild(row);
        trimToMaxBubbles();
        updateBubbleOpacity();
        scrollToBottom();
        return;
      }
    }
    const div = document.createElement('div');
    div.className = 'bg-slate-900/70 border border-cyan-500/20 rounded-xl px-4 py-2.5 text-sm text-slate-100 min-w-0 overflow-hidden transition-opacity duration-300 bubble-content shadow-md shadow-black/20';
    div.textContent = formatted;
    wrapper.appendChild(div);
  }
  row.appendChild(wrapper);
  row.appendChild(makeCopyButton(wrapper));
  bubblesEl.appendChild(row);
  trimToMaxBubbles();
  updateBubbleOpacity();
  scrollToBottom();
}

function addStreamingBubble() {
  const row = document.createElement('div');
  row.className = 'bubble-row assistant-msg';
  const div = document.createElement('div');
  div.className = 'bg-slate-900/70 border border-cyan-500/20 rounded-xl px-4 py-2.5 text-sm text-slate-100 min-w-0 overflow-hidden transition-opacity duration-300 bubble-content flex-1 shadow-md shadow-black/20';
  const loading = document.createElement('span');
  loading.className = 'bubble-loading-dots';
  loading.setAttribute('aria-hidden', 'true');
  loading.innerHTML = '<span></span><span></span><span></span>';
  div.appendChild(loading);
  row.appendChild(div);
  row.appendChild(makeCopyButton(div)); // 复制按钮在内容下方，悬停时显示
  bubblesEl.appendChild(row);
  trimToMaxBubbles();
  updateBubbleOpacity();
  scrollToBottom();
  return div;
}

/** 流式 chunk 缓冲，按帧合并更新，减少重排、缓解渲染卡顿 */
let chunkBuffer = { div: null, text: '', rafId: null };
function flushChunkBuffer() {
  if (chunkBuffer.rafId != null) {
    cancelAnimationFrame(chunkBuffer.rafId);
    chunkBuffer.rafId = null;
  }
  if (chunkBuffer.div && chunkBuffer.text) {
    const loading = chunkBuffer.div.querySelector('.bubble-loading-dots');
    if (loading) loading.remove();
    const cur = chunkBuffer.div.textContent || '';
    chunkBuffer.div.textContent = cur + chunkBuffer.text;
    chunkBuffer.text = '';
    updateBubbleOpacity();
    scrollToBottom();
  }
}
function appendToBubble(div, text) {
  if (!div) return;
  if (chunkBuffer.div !== div) {
    flushChunkBuffer();
    chunkBuffer.div = div;
  }
  chunkBuffer.text += text;
  if (chunkBuffer.rafId != null) return;
  chunkBuffer.rafId = requestAnimationFrame(() => {
    chunkBuffer.rafId = null;
    if (chunkBuffer.div && chunkBuffer.text) {
      const loading = chunkBuffer.div.querySelector('.bubble-loading-dots');
      if (loading) loading.remove();
      const cur = chunkBuffer.div.textContent || '';
      chunkBuffer.div.textContent = cur + chunkBuffer.text;
      chunkBuffer.text = '';
      updateBubbleOpacity();
      scrollToBottom();
    }
  });
}

function updateBubbleOpacity() {
  const children = bubblesEl.children;
  const n = children.length;
  for (let i = 0; i < n; i++) {
    const fromEnd = n - 1 - i;
    let opacity = 1;
    if (fromEnd <= 1) opacity = 1;
    else opacity = Math.max(0.25, 1 - fromEnd * 0.1);
    children[i].style.opacity = String(opacity);
  }
  // 不再在这里调用 scrollToBottom()，否则会一直把用户拉回底部，导致对话区域无法向上滚动
}

// 不再强制回到底部，允许用户向上滚动查看历史消息

function showDialogue() {
  if (overlay) overlay.classList.remove('hidden');
  if (inputEl) inputEl.focus();
}

let sending = false;

function setSending(v) {
  sending = v;
  if (inputEl) {
    inputEl.disabled = !!v;
    inputEl.placeholder = v ? '生成中…' : '输入消息，Shift+Enter 换行…';
  }
  if (stopBtn) stopBtn.classList.toggle('is-hidden', !v);
}

function sendUserMessage() {
  if (sending) return;
  const text = (inputEl && inputEl.value || '').trim();
  if (!text) return;
  setSending(true);
  if (inputEl) inputEl.value = '';
  addBubble('user', text);
  if (typeof window.aris !== 'undefined' && window.aris.sendMessage) {
    const streamingBubble = addStreamingBubble();
    const unsubChunk = window.aris.onDialogueChunk?.((chunk) => appendToBubble(streamingBubble, chunk));
    let unsubActions;
    if (window.aris.onAgentActions) {
      unsubActions = window.aris.onAgentActions((actions) => {
        if (!Array.isArray(actions) || actions.length === 0) return;
        const container = document.createElement('div');
        container.className = 'self-start flex flex-col gap-2.5 w-full max-w-[85%] min-w-0 max-h-[50vh] overflow-y-auto overflow-x-auto bubble-scroll-inner';
        actions.forEach((action) => {
          createBlocksForAction(action).forEach((el) => container.appendChild(el));
        });
        bubblesEl.insertBefore(container, streamingBubble.parentElement);
        trimToMaxBubbles();
        updateBubbleOpacity();
        scrollToBottom();
      });
    }
    window.aris.sendMessage(text).then((result) => {
      if (unsubChunk) unsubChunk();
      if (unsubActions) unsubActions();
      if (chunkBuffer.div === streamingBubble) flushChunkBuffer();
      const hasContent = streamingBubble.textContent && streamingBubble.textContent.trim().length > 0;
      if (result && result.error) {
        streamingBubble.textContent = result.error;
      } else if (result && result.content && !hasContent) {
        streamingBubble.textContent = formatBubbleContent(result.content);
      } else if (!hasContent) {
        streamingBubble.textContent = '';
      }
      updateBubbleOpacity();
      scrollToBottom();
    }).catch(() => {
      if (unsubChunk) unsubChunk();
      if (unsubActions) unsubActions();
      const loading = streamingBubble.querySelector('.bubble-loading-dots');
      if (loading) loading.remove();
      if (!streamingBubble.textContent || !streamingBubble.textContent.trim()) streamingBubble.textContent = '[请求失败]';
    }).finally(() => {
      setSending(false);
    });
  } else {
    addBubble('assistant', '[未连接]');
    setSending(false);
  }
}

if (container) {
  const audio = getAudioAnalyser();
  const sceneApi = audio
    ? (connectTestOscillator(), createScene(container, { getFrequencyData }))
    : createScene(container);

  if (sceneApi && sceneApi.onContainerClick) {
    container.addEventListener('click', (e) => {
      sceneApi.onContainerClick(e, showDialogue);
    });
  }

  if (inputEl) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.isComposing) return;
      if (e.shiftKey) return; // Shift+Enter 换行，不发送
      e.preventDefault();
      sendUserMessage();
    });
    inputEl.addEventListener('paste', (e) => {
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      if (text) {
        e.preventDefault();
        const start = inputEl.selectionStart ?? 0;
        const end = inputEl.selectionEnd ?? 0;
        const value = inputEl.value || '';
        inputEl.value = value.slice(0, start) + text + value.slice(end);
        inputEl.selectionStart = inputEl.selectionEnd = start + text.length;
      }
      // 当 clipboardData 无文本时不阻止默认粘贴，交给浏览器/Electron 处理，避免 Electron 下无法粘贴
    });
  }
  if (stopBtn) {
    stopBtn.classList.add('hidden');
    stopBtn.addEventListener('click', () => {
      if (typeof window.aris !== 'undefined' && window.aris.abortDialogue) window.aris.abortDialogue();
    });
  }

  if (typeof window.aris !== 'undefined' && window.aris.onProactive) {
    window.aris.onProactive((msg) => {
      addBubble('assistant', msg);
      if (overlay) overlay.classList.remove('hidden');
    });
  }
}
