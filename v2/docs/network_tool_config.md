# 网络访问工具配置（fetch_url）

Aris 可通过工具 `fetch_url` 主动获取网页正文（仅 GET），用于了解新闻、文档、百科等。本页说明配置项与安全策略。

## 配置从哪里改（用户可见）

- **推荐**：在应用内 **设置** 页的「网络访问（fetch_url）」区块中直接修改并保存。配置会写入数据目录下的 `config.json`，保存后**下次对话即生效**，无需重启。
- **数据目录**：设置页顶部会显示「当前配置与数据目录」路径；详见 [README](README.md#配置) 中「数据目录与 memory 文件在哪里」。

以下为底层说明；若已用设置页配置，可跳过。

## 配置文件位置（底层）

- **运行时配置**：数据目录下的 `config.json`（设置页读写）。若存在，其网络相关键会覆盖下方 memory 文件中的对应项（通过环境变量注入）。
- **memory 默认/备用**：数据目录下的 `memory/network_config.json`（文件名可由 `memory_files.json` 的 `network_config` 覆盖）。若 `config.json` 未设置某键，则使用此文件；若文件不存在，首次使用网络工具时会自动生成默认配置。

## 配置项说明

| 字段 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| **enable_web_fetch** | boolean | 是否启用网络抓取；为 false 时模型不暴露 fetch_url 工具，调用会返回「未启用」 | true |
| **allowed_hosts** | string[] | 白名单域名；为空表示不限制，非空时仅允许列表中的 host | [] |
| **blocked_hosts** | string[] | 黑名单域名；命中则拒绝请求（如 localhost、127.0.0.1、内网） | [] |
| **timeout_ms** | number | 单次请求超时（毫秒），范围 5000～60000 | 15000 |
| **max_calls_per_minute** | number | 速率限制：每分钟最多调用次数（全局/会话），范围 1～60 | 10 |
| **max_length** | number | 返回正文最大字符数，范围 1000～100000 | 8000 |
| **reject_unauthorized** | boolean | 是否校验 HTTPS 证书；为 false 时跳过证书校验（仅当出现「unable to get local issuer certificate」时建议关闭） | true |
| **enable_web_fetch_js** | boolean | 是否允许 fetch_url 使用无头浏览器（Puppeteer）；为 true 时模型可传 use_js: true 抓取 B 站等依赖 JavaScript 渲染的页面 | true |

## 环境变量（覆盖配置文件）

以下环境变量可覆盖 `network_config.json` 中的对应项，便于部署或临时开关：

| 变量名 | 说明 | 示例 |
|--------|------|------|
| **ENABLE_WEB_FETCH** | 是否启用 | `true` / `false` |
| **WEB_FETCH_ALLOWED_HOSTS** | 白名单，逗号分隔 | `example.com,api.example.com` |
| **WEB_FETCH_BLOCKED_HOSTS** | 黑名单，逗号分隔 | `localhost,127.0.0.1` |
| **WEB_FETCH_TIMEOUT_MS** | 超时毫秒 | `15000` |
| **WEB_FETCH_MAX_CALLS_PER_MINUTE** | 每分钟最多调用次数 | `10` |
| **WEB_FETCH_MAX_LENGTH** | 返回正文最大字符数 | `8000` |
| **REJECT_UNAUTHORIZED** | 是否校验 HTTPS 证书；`false` 时跳过校验 | `true` / `false` |

## 工具行为

- **fetch_url**：默认仅 GET、不执行脚本；对 B 站等纯 JS 渲染的页面可传 `use_js: true` 用无头浏览器渲染后再取正文。支持可选参数：
  - `url`（必填）：完整 http(s) URL
  - `use_js`：为 true 时用 Puppeteer 打开页面再取正文，适用于依赖 JavaScript 的站点（需配置 enable_web_fetch_js 为 true）
  - `max_length`：本次返回最大字符数（不超过配置上限）
  - `selector`：CSS 选择器，只抽取页面中某类元素（如 `main`、`article`、`.content`），减少噪音
  - `summarize`：为 true 时对正文用 LLM 做简短摘要再返回，节省 token

## 安全与审计

- 仅允许 `http://`、`https://`；禁止内网或敏感 host 时请配置 `blocked_hosts` 或 `WEB_FETCH_BLOCKED_HOSTS`。
- 速率限制按「全局」或「当前会话」统计，超过 `max_calls_per_minute` 会返回「请求过于频繁」。
- 日志：每次请求会打一条日志，包含 URL、HTTP 状态码、是否截断、返回长度，便于审计（见控制台或运行日志）。

### HTTPS 证书校验

- 若出现 **unable to get local issuer certificate**（常见于 Electron/本机环境未使用系统证书库），可在设置页勾选「不验证 HTTPS 证书」，或设置 `reject_unauthorized: false`（`network_config.json`）或环境变量 `REJECT_UNAUTHORIZED=false`，以恢复 HTTPS 访问。
- 关闭证书校验会降低安全性（易受中间人攻击），仅建议在可信本机环境下使用。

## 如何在本机测试

1. **启用功能**  
   - 复制 `v2/.env.example` 为 `v2/.env`，保证有 `ENABLE_WEB_FETCH=true`（或不在 .env 里写，使用默认开启）。  
   - 本机数据目录建议设 `ARIS_V2_DATA_DIR=v2/data`，便于在 `v2/data/memory/` 下查看或修改 `network_config.json`。

2. **启动应用**  
   - 在 v2 目录执行 `npm start`，进入对话界面。

3. **触发 fetch_url**  
   - 在对话里用自然语言让 Aris 去「查一下某网页」或「打开某个 URL 看看内容」，例如：  
     - 「帮我看看 https://example.com 页面上写了什么」  
     - 「查一下 https://www.wikipedia.org 关于某某词条的第一段」  
   - Aris 会调用 `fetch_url` 抓取正文并基于内容回复；若未配置 API Key 或网络未启用，会提示相应错误。

4. **看日志**  
   - 控制台会打印每次请求：`[Aris v2][fetch_url] url= ... use_js= ... status= ... truncated= ... length= ...`，可确认是否成功、是否被截断、是否走了无头浏览器。

5. **用配置文件调参**  
   - 编辑 `v2/data/memory/network_config.json`（需先跑过一次或手动创建）可改 `enable_web_fetch`、`allowed_hosts`、`blocked_hosts`、`timeout_ms`、`max_calls_per_minute`、`max_length`。修改后**需重启应用**才会生效（工具列表在启动时按配置生成）。

---

## 安全限制

| 限制类型 | 说明 |
|----------|------|
| **协议** | 仅允许 `http://` 和 `https://`，其他协议一律拒绝。 |
| **方法** | 仅 GET，不提交表单、不执行页面脚本。 |
| **内网/本机** | 默认黑名单包含 `localhost`、`127.0.0.1`，无法访问本机服务；如需访问内网其他 IP，需在配置或环境变量中调整 `blocked_hosts`（不建议对公网开放时放宽）。 |
| **白名单（可选）** | 若配置了 `allowed_hosts` 且非空，则**只允许**列表中的 host，其它域名一律拒绝。 |
| **黑名单** | `blocked_hosts` 中的 host 一律拒绝；环境变量 `WEB_FETCH_BLOCKED_HOSTS` 可覆盖。 |
| **超时** | 单次请求超时（默认 15s，可配 5～60s），超时即失败，不会长时间挂起。 |
| **速率** | 每分钟最多 N 次调用（默认 10，可配 1～60），按会话或全局统计，超过即返回「请求过于频繁」。 |
| **内容长度** | 返回正文最大字符数有上限（默认 8000，可配），防止单次拉取过大。 |
| **审计** | 每次请求会在日志中记录 URL、状态码、是否截断、长度，便于事后排查。 |

生产或对外部署时建议：开启 `enable_web_fetch` 时至少保留默认黑名单、速率限制与超时；若只允许访问少数可信站点，可配置 `allowed_hosts` 白名单。

---

## 与 README 的对应关系

README 的「可配置项一览」表中已列出 `network_config.json` 及上述字段概要；详细说明以本文档为准。
