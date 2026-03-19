const { spawn } = require('child_process');
const { app } = require('electron');
const { getV2Root } = require('../../../config/paths.js');

let restartScheduled = false;

function getNpmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function getStartCommandArgs(mode) {
  if (!mode || mode === 'npm_start') return ['start'];
  return null;
}

async function runAppTool(name, args) {
  if (name !== 'restart_application') return { ok: false, error: 'Unknown tool' };

  const a = args || {};
  const mode = typeof a.mode === 'string' ? a.mode : 'npm_start';
  const delayMs = Number.isFinite(Number(a.delay_ms)) ? Math.max(250, Number(a.delay_ms)) : 1500;
  const resumeTools = Array.isArray(a.resume_tools) ? a.resume_tools : [];
  const resumeMessage = typeof a.resume_message === 'string' && a.resume_message.trim()
    ? a.resume_message.trim()
    : null;

  if (restartScheduled) {
    return { ok: false, error: '重启已在进行中' };
  }
  restartScheduled = true;

  // 保存重启前的工作状态
  try {
    const workState = require('../../../store/workState.js');
    // 只允许“当前这次重启”的续跑任务，避免旧 pending 在后续误触发
    workState.clearPendingTasks?.();
    if (resumeTools.length) {
      workState.addPendingTask({
        kind: 'resume_tools',
        mode,
        resume_tools: resumeTools,
        resume_message: resumeMessage,
      });
    }
    workState.savePreRestartState();
    console.info('[Aris v2] 已保存重启前工作状态');
  } catch (e) {
    console.warn('[Aris v2] 保存重启状态失败', e?.message);
  }

  const cmdArgs = getStartCommandArgs(mode);
  if (!cmdArgs) {
    return { ok: false, error: `不支持的重启模式: ${mode}` };
  }

  const cwd = getV2Root();
  const npmBin = getNpmBin();

  // detached: true 且 stdio: ignore：确保当前进程退出后，新进程仍能继续
  spawn(npmBin, cmdArgs, {
    cwd,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });

  // 给 handler/LMM 一点时间返回工具结果与下一轮输出
  setTimeout(() => {
    try {
      app.exit(0);
    } catch (_) {
      process.exit(0);
    }
  }, delayMs);

  return { ok: true, message: '正在重启应用（执行 npm start）…' };
}

const APP_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'restart_application',
      description: '模拟执行 v2 下的 npm start 来重启整个应用进程，从而加载最新代码更改。仅在用户明确说“重启/重新开始/重新启动应用”时调用。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['npm_start'],
            default: 'npm_start',
            description: '当前仅支持用 npm_start 方式重启',
          },
          delay_ms: {
            type: 'number',
            description: '重启退出前延迟毫秒（避免工具结果来不及回传）',
            default: 1500,
          },
          resume_tools: {
            type: 'array',
            description: '重启后需要继续执行的工具动作列表（按顺序）。每项形如 { tool_name, args }。',
            items: {
              type: 'object',
              properties: {
                tool_name: { type: 'string', description: '工具名，如 delete_file' },
                args: { type: 'object', description: '该工具的参数对象' },
              },
              required: ['tool_name'],
            },
          },
          resume_message: {
            type: 'string',
            description: '重启续跑完成后写入一条简短 assistant 文本（可选）',
          },
        },
        required: [],
      },
    },
  },
];

module.exports = { APP_TOOLS, runAppTool };

