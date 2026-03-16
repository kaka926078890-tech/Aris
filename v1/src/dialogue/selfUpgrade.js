/**
 * Aris 自升级：根据近期对话反思问题与局限，产生改进并记录。由 proactive 在满足条件时调用。
 */
const path = require('path');
const fs = require('fs');
const { chat } = require('./api.js');
const { writeFile } = require('../agentFiles.js');

const SELF_UPGRADE_LOG_PATH = path.join(__dirname, '../../memory/self_upgrade_log.md');

const ALLOWED_PATH_PREFIXES = ['src/dialogue/', 'memory/'];
const ALLOWED_EXTENSIONS = ['.js', '.md'];

function isPathAllowed(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('..')) return false;
  const norm = path.normalize(relativePath).replace(/\\/g, '/');
  const allowed = ALLOWED_PATH_PREFIXES.some((p) => norm.startsWith(p));
  if (!allowed) return false;
  const ext = path.extname(norm);
  return ALLOWED_EXTENSIONS.includes(ext);
}

function buildSelfUpgradePrompt(recentDialogueSummary, rulesSnippet) {
  return `你是 Aris 的自我反思模块。根据以下近期对话与当前行为规则，反思自身对话中的**问题或局限**，提出可落地的改进点（如改某段逻辑、某文件行为）。

【近期对话摘要】
${recentDialogueSummary || '（无）'}

【当前行为规则片段】
${rulesSnippet || '（无）'}

请按以下格式输出（务必包含所有标题）：

### 理由
（为何要升级、发现的问题或局限）

### 目标
（本次升级想达到什么）

### 修改的内容
（改了哪些文件/逻辑、简要说明。若需直接给出可执行的文件修改，请用：
FILE: 相对路径（仅限 src/dialogue/*.js 或 memory/*.md）
CONTENT:
（该文件的完整新内容，用于覆盖写入）
以上 FILE/CONTENT 为可选项，若无则只写文字说明即可。）

### 结论
（结果如何、是否达成目标、后续建议等）`;
}

function parseSelfUpgradeResponse(content) {
  if (!content || typeof content !== 'string') return null;
  const sections = {};
  const headers = ['理由', '目标', '修改的内容', '结论'];
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i];
    const nextName = headers[i + 1];
    const endPattern = nextName ? `###\\s*${nextName}` : '$';
    const re = new RegExp(`###\\s*${name}\\s*\\n([\\s\\S]*?)(?=${endPattern})`, 'i');
    const m = content.match(re);
    if (m) sections[name] = m[1].trim();
  }
  const modifyBlock = sections['修改的内容'] || '';
  let filePath = null;
  let fileContent = null;
  const fileMatch = modifyBlock.match(/FILE:\s*([^\n]+)\s*\nCONTENT:\s*\n([\s\S]*?)(?=\n###|$)/i);
  if (fileMatch) {
    filePath = fileMatch[1].trim();
    fileContent = fileMatch[2].trimEnd();
  }
  return { sections, filePath, fileContent };
}

async function runSelfUpgrade() {
  try {
    const { getRecent } = require('../store/conversations.js');
    const { getCurrentSessionId } = require('../store/conversations.js');
    const sessionId = await getCurrentSessionId();
    const recent = await getRecent(sessionId, 12);
    const recentDialogueSummary = recent
      .map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${(r.content || '').slice(0, 200)}`)
      .join('\n');
    const rulesPath = path.join(__dirname, 'rules.md');
    let rulesSnippet = '';
    if (fs.existsSync(rulesPath)) {
      rulesSnippet = fs.readFileSync(rulesPath, 'utf8').slice(0, 2000);
    }
    const prompt = buildSelfUpgradePrompt(recentDialogueSummary, rulesSnippet);
    const messages = [
      { role: 'system', content: '你只输出自升级反思内容，严格按要求的 ### 标题格式，不要输出其他无关内容。' },
      { role: 'user', content: prompt },
    ];
    const { content, error } = await chat(messages);
    if (error || !content) {
      console.warn('[Aris][selfUpgrade] LLM 调用失败或无内容');
      return { ok: false, error: 'LLM 调用失败或无内容' };
    }
    const parsed = parseSelfUpgradeResponse(content);
    if (!parsed || !parsed.sections.理由) {
      console.warn('[Aris][selfUpgrade] 解析失败，无法提取理由等字段');
      return { ok: false, error: '解析失败' };
    }
    if (parsed.filePath && parsed.fileContent && isPathAllowed(parsed.filePath)) {
      const result = writeFile(parsed.filePath, parsed.fileContent, false);
      if (!result.ok) {
        console.warn('[Aris][selfUpgrade] 写入文件失败:', parsed.filePath, result.error);
      } else {
        console.info('[Aris][selfUpgrade] 已按白名单写入:', parsed.filePath);
      }
    } else if (parsed.filePath && !isPathAllowed(parsed.filePath)) {
      console.warn('[Aris][selfUpgrade] 跳过非白名单路径:', parsed.filePath);
    }
    const now = new Date();
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const logEntry = `

---

### 升级时间

${timeStr}

### 理由

${parsed.sections.理由}

### 目标

${parsed.sections.目标 || '（无）'}

### 修改的内容

${parsed.sections['修改的内容'] || '（无）'}

### 结论

${parsed.sections.结论 || '（无）'}
`;
    const logDir = path.dirname(SELF_UPGRADE_LOG_PATH);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(SELF_UPGRADE_LOG_PATH, logEntry, 'utf8');
    console.info('[Aris][selfUpgrade] 已追加记录到', SELF_UPGRADE_LOG_PATH);
    return { ok: true };
  } catch (e) {
    console.warn('[Aris][selfUpgrade] 执行异常', e);
    return { ok: false, error: e.message };
  }
}

module.exports = { runSelfUpgrade, buildSelfUpgradePrompt, parseSelfUpgradeResponse, isPathAllowed };
