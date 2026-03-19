/**
 * 工作状态存储：保存当前的工作流程、未完成的任务、正在思考的问题等
 * 用于在重启后恢复工作状态
 */
const fs = require('fs');
const { getWorkStatePath, getDataDir } = require('../config/paths.js');

function readWorkState() {
  try {
    const p = getWorkStatePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return {
      // 当前工作流程描述
      current_workflow: data.current_workflow || null,
      // 未完成的任务列表
      pending_tasks: Array.isArray(data.pending_tasks) ? data.pending_tasks : [],
      // 正在思考的问题
      thinking_questions: Array.isArray(data.thinking_questions) ? data.thinking_questions : [],
      // 最近的工作上下文
      recent_context: data.recent_context || null,
      // 上次保存时间
      last_saved_at: data.last_saved_at || null,
      // 重启前最后的状态
      pre_restart_state: data.pre_restart_state || null,
    };
  } catch (_) {
    return null;
  }
}

function writeWorkState(updates) {
  try {
    const current = readWorkState() || {};
    const data = {
      current_workflow: updates.current_workflow !== undefined ? updates.current_workflow : current.current_workflow,
      pending_tasks: updates.pending_tasks !== undefined ? updates.pending_tasks : current.pending_tasks,
      thinking_questions: updates.thinking_questions !== undefined ? updates.thinking_questions : current.thinking_questions,
      recent_context: updates.recent_context !== undefined ? updates.recent_context : current.recent_context,
      last_saved_at: new Date().toISOString(),
      pre_restart_state: updates.pre_restart_state !== undefined ? updates.pre_restart_state : current.pre_restart_state,
    };
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getWorkStatePath(), JSON.stringify(data, null, 2), 'utf8');
    const timeline = require('./timeline.js');
    timeline.appendEntry({ type: 'work_state', payload: data, actor: 'system' });
  } catch (e) {
    console.warn('[Aris v2][store/workState] writeWorkState failed', e?.message);
  }
}

/**
 * 保存重启前的状态
 */
function savePreRestartState() {
  const current = readWorkState() || {};
  const recentConversation = require('./conversations.js').getRecentConversation;
  const facade = require('./facade.js');
  
  // 获取最近的对话作为上下文
  facade.getCurrentSessionId().then(sessionId => {
    return facade.getRecentConversation(sessionId, 10);
  }).then(recent => {
    const preRestartState = {
      last_conversation: recent.slice(-3), // 保存最后3轮对话
      saved_at: new Date().toISOString(),
      reason: 'application_restart',
    };
    
    writeWorkState({
      pre_restart_state: preRestartState,
      recent_context: current.recent_context || `重启前正在处理: ${recent.length > 0 ? recent[recent.length - 1].content : '未知'}`,
    });
  }).catch(e => {
    console.warn('[Aris v2][store/workState] savePreRestartState failed', e?.message);
  });
}

/**
 * 获取重启后需要恢复的状态
 */
function getPostRestartRecoveryInfo() {
  const state = readWorkState();
  if (!state || !state.pre_restart_state) return null;
  
  return {
    has_recovery_info: true,
    last_conversation: state.pre_restart_state.last_conversation || [],
    saved_at: state.pre_restart_state.saved_at,
    recent_context: state.recent_context,
    pending_tasks: state.pending_tasks,
    thinking_questions: state.thinking_questions,
  };
}

/**
 * 清除重启状态（重启恢复后调用）
 */
function clearRestartState() {
  const current = readWorkState() || {};
  writeWorkState({
    ...current,
    pre_restart_state: null,
  });
}

/**
 * 添加未完成任务
 */
function addPendingTask(task) {
  const current = readWorkState() || {};
  const tasks = Array.isArray(current.pending_tasks) ? current.pending_tasks : [];
  tasks.push({
    task,
    added_at: new Date().toISOString(),
    completed: false,
  });
  writeWorkState({ pending_tasks: tasks });
}

/**
 * 标记任务为完成
 */
function completePendingTask(index) {
  const current = readWorkState() || {};
  const tasks = Array.isArray(current.pending_tasks) ? current.pending_tasks : [];
  if (index >= 0 && index < tasks.length) {
    tasks[index].completed = true;
    tasks[index].completed_at = new Date().toISOString();
    writeWorkState({ pending_tasks: tasks });
  }
}

/**
 * 获取未完成的任务
 */
function getPendingTasks() {
  const current = readWorkState() || {};
  const tasks = Array.isArray(current.pending_tasks) ? current.pending_tasks : [];
  return tasks
    .map((t, idx) => ({ ...t, index: idx }))
    .filter((t) => !t?.completed);
}

/**
 * 清空所有待重启续办任务
 */
function clearPendingTasks() {
  writeWorkState({ pending_tasks: [] });
}

module.exports = {
  readWorkState,
  writeWorkState,
  savePreRestartState,
  getPostRestartRecoveryInfo,
  clearRestartState,
  addPendingTask,
  completePendingTask,
  getPendingTasks,
  clearPendingTasks,
};
