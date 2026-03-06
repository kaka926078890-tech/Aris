import { createScene } from '../engine/scene.js';
import { getAudioAnalyser, connectTestOscillator, getFrequencyData } from '../audio/waveform.js';

const container = document.getElementById('canvas-container');
const overlay = document.getElementById('dialogue-overlay');
const bubblesWrap = document.getElementById('bubbles-wrap');
const bubblesEl = document.getElementById('bubbles');
const inputEl = document.getElementById('dialogue-input');

function scrollToBottom() {
  if (bubblesWrap) bubblesWrap.scrollTop = bubblesWrap.scrollHeight;
}

const sendBtn = document.getElementById('dialogue-send');

function addBubble(role, content) {
  const div = document.createElement('div');
  div.className = role === 'user'
    ? 'self-end bg-cyan-500/20 border border-cyan-500/40 rounded-lg px-3 py-2 text-sm text-cyan-100 max-w-[85%] transition-opacity duration-300'
    : 'self-start bg-black/50 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-cyan-200 max-w-[85%] transition-opacity duration-300';
  div.textContent = content;
  bubblesEl.appendChild(div);
  updateBubbleOpacity();
  scrollToBottom();
}

function addStreamingBubble() {
  const div = document.createElement('div');
  div.className = 'self-start bg-black/50 border border-cyan-500/30 rounded-lg px-3 py-2 text-sm text-cyan-200 max-w-[85%] transition-opacity duration-300';
  div.textContent = '';
  bubblesEl.appendChild(div);
  updateBubbleOpacity();
  scrollToBottom();
  return div;
}

function appendToBubble(div, text) {
  div.textContent += text;
  updateBubbleOpacity();
  scrollToBottom();
}

function updateBubbleOpacity() {
  const children = bubblesEl.children;
  const n = children.length;
  for (let i = 0; i < n; i++) {
    const fromEnd = n - 1 - i;
    let opacity = 1;
    if (fromEnd === 2) opacity = 0.45;
    else if (fromEnd > 2) opacity = Math.max(0, 0.2 - (fromEnd - 3) * 0.1);
    children[i].style.opacity = String(opacity);
  }
  scrollToBottom();
}

if (bubblesWrap) {
  bubblesWrap.addEventListener('scroll', () => {
    const maxScroll = bubblesWrap.scrollHeight - bubblesWrap.clientHeight;
    if (maxScroll > 0 && bubblesWrap.scrollTop < maxScroll) {
      bubblesWrap.scrollTop = bubblesWrap.scrollHeight;
    }
  });
}

function showDialogue() {
  if (overlay) overlay.classList.remove('hidden');
  if (inputEl) inputEl.focus();
}

let sending = false;

function sendUserMessage() {
  if (sending) return;
  const text = (inputEl && inputEl.value || '').trim();
  if (!text) return;
  sending = true;
  if (inputEl) inputEl.value = '';
  addBubble('user', text);
  if (typeof window.aris !== 'undefined' && window.aris.sendMessage) {
    const streamingBubble = addStreamingBubble();
    const unsub = window.aris.onDialogueChunk?.((chunk) => appendToBubble(streamingBubble, chunk));
    window.aris.sendMessage(text).then((result) => {
      if (unsub) unsub();
      if (result && result.content && !streamingBubble.textContent) {
        streamingBubble.textContent = result.content;
      }
      updateBubbleOpacity();
      scrollToBottom();
    }).catch(() => {
      if (unsub) unsub();
      if (!streamingBubble.textContent) streamingBubble.textContent = '[请求失败]';
    }).finally(() => {
      sending = false;
    });
  } else {
    addBubble('assistant', '[未连接]');
    sending = false;
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

  if (sendBtn) sendBtn.addEventListener('click', sendUserMessage);
  if (inputEl) inputEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.isComposing) return;
    e.preventDefault();
    sendUserMessage();
  });

  if (typeof window.aris !== 'undefined' && window.aris.onProactive) {
    window.aris.onProactive((msg) => {
      addBubble('assistant', msg);
      if (overlay) overlay.classList.remove('hidden');
    });
  }
}
