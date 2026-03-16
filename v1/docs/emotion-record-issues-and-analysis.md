# 「改不动了」上下文来源排查说明

## 现象

Aris 在回复中提到：`user_name.txt` 里记录的名字是 PiiKaQiu，但根据上下文用户现在的名字是「改不动了」。

## 结论概览

「改不动了」**不是**来自 `memory/user_name.txt`（该文件内容为「用户的名字是：PiiKaQiu」）。  
它来自**每轮注入系统 prompt 的【用户曾告知的身份与要求】**，可能来自以下两处之一（或同时存在）。

---

## 来源 1：`memory/user_identity.json`

- **路径**：`memory/user_identity.json`（与其它记忆文件同目录）。
- **逻辑**：`handler.js` 每轮调用 `loadUserIdentity()` 读取该文件，若有 `name` 则拼成 `用户名字：${data.name}` 注入【用户曾告知的身份与要求】。
- **何时被写成「改不动了」**：当用户某条消息里出现过「我叫改不动了」或「我是改不动了」时，`updateUserIdentityFromMessage()` 会用正则 `(?:我叫|我是|你可以叫我|我的名字是?)\\s*([^\\s,，。！？]+)` 提取并写入 `user_identity.json` 的 `name` 字段。

**如何确认**：打开 `memory/user_identity.json`，看 `name` 是否为 `"改不动了"`。

---

## 来源 2（最可能）：向量检索记忆中的「你是改不动了」被误当作用户名

- **逻辑**：`handler.js` 每轮会做语义检索 `retrieve(query, 12)`，得到一批记忆片段 `memories`。然后调用 `extractIdentityFromMemories(memories)`，用正则从记忆**文本**里抽取「用户名字」：
  - 正则：`/你是[「\\\"]?\\s*([^\\s」\\\"，。！？、]{1,20})[」\\\"]?/`
  - 含义：匹配「你是 XXX」中的 XXX（1–20 字），并生成 `用户名字：XXX` 注入【用户曾告知的身份与要求】。
- **问题**：「你是改不动了」在中文里通常表示「你（Aris）改不动了/卡住了」，**不是**用户的名字。但该正则会匹配到「改不动了」并当作用户名注入，导致 Aris 认为「上下文里用户名字是改不动了」。

**如何确认**：在 LanceDB（或当前项目使用的向量库）里搜索包含「改不动了」或「你是改不动了」的记忆条，若存在且被检索到，就会进入 `extractIdentityFromMemories` 并被当成用户名。

---

## 为何 Aris 会说「文件里是 PiiKaQiu，上下文是改不动了」

- **系统 prompt 注入**：【用户曾告知的身份与要求】= `identityFromFile` + `identityFromRetrieved` + `requirementTexts`。  
  - `identityFromFile`：来自 `memory/user_identity.json`（**不是** `memory/user_name.txt`）。  
  - `identityFromRetrieved`：来自 `extractIdentityFromMemories(memories)`，即向量检索结果里「你是 XXX」的 XXX。
- **user_name.txt**：在 Aris 的「自己文件夹」里，只有 Aris 主动调用 `read_file(\"memory/user_name.txt\")` 时才会读到，**不会**自动进入系统 prompt。
- 因此：若某轮注入里出现了「用户名字：改不动了」（来自来源 1 或 2），而 Aris 又读过 `user_name.txt`（PiiKaQiu），就会产生「文件里是 PiiKaQiu，上下文里是改不动了」的说法。

---

## 建议处理

1. **排查**  
   - 查看 `memory/user_identity.json` 的 `name` 是否为「改不动了」，若是则改回正确名字或清空。  
   - 在向量库中查找含有「改不动了」或「你是改不动了」的记忆，确认是否被检索并抽成「用户名字」。

2. **代码防护**  
   - 在 `extractIdentityFromMemories` 中对明显不是人名的短语做过滤（见下节），例如将「改不动了」加入 blocklist，避免再次被当成用户名注入。
