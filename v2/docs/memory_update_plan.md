好的，基于我们之前的讨论，我来为你设计一套完整的、可直接落地的Agent外部记忆检索优化方案。

这个方案的核心思想是：**用混合检索（Hybrid Search）替代纯向量检索，用重排序（Re-ranking）提升最终质量。** 根据研究，这样可以将检索准确率提升20个百分点以上。

---

## 🎯 方案全景图

```
用户查询
    ↓
┌─────────────────────────────────────────────────────┐
│                检索层 (Retrieval)                     │
├─────────────────────────────────────────────────────┤
│  1️⃣ 稠密检索 (向量)  ──┐                              │
│  2️⃣ 稀疏检索 (BM25)  ──┼─→ 合并候选 (约40条) → 重排序   │
│  3️⃣ 时序索引 (可选)  ──┘                              │
└─────────────────────────────────────────────────────┘
                            ↓
                   Top-15 高相关性记忆
                            ↓
┌─────────────────────────────────────────────────────┐
│                生成层 (Generation)                    │
│              LLM + 定制Prompt → 最终回答               │
└─────────────────────────────────────────────────────┘
```

---

## 🏗️ 第一步：存储层设计

### 数据库选型建议

| 场景 | 推荐方案 | 说明 |
|------|----------|------|
| **原型开发/单用户** | SQLite + sqlite-vec | 零配置，本地运行，支持向量检索 |
| **生产环境** | Chroma / Qdrant / Milvus | 专业向量数据库，支持混合检索 |
| **超大规模** | Pinecone / Weaviate | 云原生，托管服务 |

### 表结构设计（以SQLite为例）

```sql
CREATE TABLE memory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,                    -- 用户标识
    session_id TEXT,                  -- 会话标识
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    input TEXT,                       -- 用户输入
    output TEXT,                      -- Agent回复
    summary TEXT,                      -- LLM生成的摘要（关键！）
    embedding BLOB,                    -- 向量（768维）
    keywords TEXT,                     -- 关键词（用于BM25）
    metadata JSON                      -- 额外元数据
);

CREATE INDEX idx_user_time ON memory_events(user_id, timestamp);
CREATE INDEX idx_session ON memory_events(session_id);
```

**核心优化点**：存**摘要**比存完整对话效果好得多。每次交互后用轻量LLM生成一句话摘要：

```python
summary_prompt = f"用一句话总结这次对话的核心内容：\n用户：{input}\n助手：{output}"
summary = llm.complete(summary_prompt)  # 调用你的Chat模型
```

---

## 🔍 第二步：混合检索实现（核心！）

这是整个方案的重中之重。纯向量检索会错过精确关键词匹配，纯BM25会错过语义相似内容。**两者结合，效果最佳**。

### 代码实现（可直接复制修改）

```python
import numpy as np
from sentence_transformers import SentenceTransformer
from rank_bm25 import BM25Okapi
import sqlite3
from typing import List, Dict, Any
import json

class HybridMemoryRetriever:
    def __init__(self, db_path: str, embed_model_name: str = "nomic-embed-text-v2-moe"):
        """
        初始化混合检索器
        embed_model: 你的nomic-embed-text模型（或其他轻量嵌入模型）
        """
        self.db_path = db_path
        # 初始化嵌入模型（用你之前了解的nomic-embed-text）
        self.embed_model = SentenceTransformer(embed_model_name)
        # 连接数据库
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        
    def get_all_summaries(self) -> List[str]:
        """获取所有摘要用于BM25索引"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT id, summary FROM memory_events")
        rows = cursor.fetchall()
        return [(row['id'], row['summary']) for row in rows]
    
    def build_bm25_index(self):
        """构建或更新BM25索引"""
        summaries = self.get_all_summaries()
        self.bm25_ids = [s[0] for s in summaries]
        # 分词处理（简单按空格分，可替换为jieba等）
        tokenized = [s[1].split() for s in summaries]
        self.bm25 = BM25Okapi(tokenized)
    
    def dense_retrieve(self, query: str, top_k: int = 20) -> List[Dict]:
        """
        稠密检索：向量相似度
        用你的nomic-embed-text生成查询向量
        """
        query_emb = self.embed_model.encode(query)
        
        cursor = self.conn.cursor()
        # 注意：实际向量检索需要数据库支持，这里简化示意
        # 生产环境用sqlite-vec或专业向量数据库
        cursor.execute("""
            SELECT id, summary, timestamp, metadata,
                   1 - (embedding <-> ?) as similarity
            FROM memory_events
            ORDER BY similarity DESC
            LIMIT ?
        """, (query_emb.tobytes(), top_k))
        
        return [dict(row) for row in cursor.fetchall()]
    
    def sparse_retrieve(self, query: str, top_k: int = 20) -> List[Dict]:
        """
        稀疏检索：BM25关键词匹配
        专门捕获精确术语、名称、日期等
        """
        if not hasattr(self, 'bm25'):
            self.build_bm25_index()
        
        tokenized_query = query.split()
        scores = self.bm25.get_scores(tokenized_query)
        
        # 获取top_k索引
        top_indices = np.argsort(scores)[-top_k:][::-1]
        
        results = []
        for idx in top_indices:
            if scores[idx] > 0:  # 只返回有匹配的
                mem_id = self.bm25_ids[idx]
                cursor = self.conn.cursor()
                cursor.execute("SELECT id, summary, timestamp, metadata FROM memory_events WHERE id = ?", (mem_id,))
                row = cursor.fetchone()
                if row:
                    result = dict(row)
                    result['bm25_score'] = float(scores[idx])
                    results.append(result)
        return results
    
    def hybrid_retrieve(self, query: str, 
                        dense_k: int = 20, 
                        sparse_k: int = 20, 
                        final_k: int = 15) -> List[Dict]:
        """
        混合检索 + 重排序准备
        """
        # 1. 分别获取两种结果
        dense_results = self.dense_retrieve(query, dense_k)
        sparse_results = self.sparse_retrieve(query, sparse_k)
        
        # 2. 合并去重（按id）
        seen_ids = set()
        merged = []
        
        for r in dense_results + sparse_results:
            if r['id'] not in seen_ids:
                seen_ids.add(r['id'])
                merged.append(r)
        
        print(f"📊 检索统计：向量 {len(dense_results)}条，BM25 {len(sparse_results)}条，"
              f"重叠 {len(dense_results)+len(sparse_results)-len(merged)}条，合并 {len(merged)}条")
        
        # 返回合并结果，等待重排序
        return merged
```

### 关键参数说明

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `dense_k` | 20 | 向量检索召回数 |
| `sparse_k` | 20 | BM25召回数 |
| `final_k` | 15 | 最终送给LLM的记忆数 |
| 重叠率 | 20-30% | 两种检索的重叠度，正常现象 |

---

## ⚖️ 第三步：重排序层（Re-ranking）

合并后的候选集需要**重新打分排序**，因为向量相似度和BM25分数不可直接比较。

### 轻量级重排序（免费方案）

用**交叉编码器（Cross-Encoder）**对每个(query, memory)对打分：

```python
from sentence_transformers import CrossEncoder

class ReRanker:
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-12-v2"):
        """
        初始化重排序模型
        轻量级，约500MB，可本地运行
        """
        self.model = CrossEncoder(model_name)
    
    def rerank(self, query: str, candidates: List[Dict], top_k: int = 15) -> List[Dict]:
        """
        对候选记忆进行重排序
        """
        if not candidates:
            return []
        
        # 准备(pair)对
        pairs = [(query, c['summary']) for c in candidates]
        
        # 计算相关性分数
        scores = self.model.predict(pairs)
        
        # 合并分数并排序
        for i, score in enumerate(scores):
            candidates[i]['rerank_score'] = float(score)
        
        # 按重排序分数降序排列
        reranked = sorted(candidates, key=lambda x: x['rerank_score'], reverse=True)
        
        return reranked[:top_k]
```

### 重排序的效果

| 指标 | 纯向量检索 | 纯BM25 | 混合+重排序 |
|------|-----------|--------|-------------|
| 准确率（@15） | 基准 | 略低 | **提升15-25%** |
| 召回精度 | 可能错过关键词 | 可能错过语义 | **两者兼顾** |

---

## 🧠 第四步：生成层优化

检索到的记忆需要以**最优方式**注入LLM的上下文。

### 定制Prompt模板

```python
PROMPT_TEMPLATE = """你是一个有记忆能力的智能助手。以下是与你当前问题相关的历史记忆（按相关性排序）：

【历史记忆】
{context}

【当前问题】
{query}

【指令】
1. 请先参考【历史记忆】中的相关信息
2. 如果记忆中有相关内容，请结合记忆回答问题
3. 如果记忆不足以回答，请用你的知识补充，并说明"根据记忆，...；此外..."
4. 回答结束时，列出你参考的记忆片段（用id或时间标识）

请开始回答：
"""
```

### 记忆注入策略

| 记忆数量 | 处理方式 |
|----------|----------|
| 0-5条 | 全部注入，详细引用 |
| 6-15条 | 注入，但要求LLM优先用前5条 |
| >15条 | 先用重排序选出15条，再注入 |

---

## 📈 第五步：进阶优化（可选）

如果基础方案满足需求后想进一步提升，可以考虑：

### 1. 时序索引（Temporal Index）

研究发现，很多查询有**时间局部性**——相关记忆集中在特定时间段。SwiftMem系统通过时序索引实现**对数级检索**，比全量扫描快47倍。

```python
# 按时间分段存储
def get_time_range_memories(user_id, days_back=7):
    cursor.execute("""
        SELECT * FROM memory_events 
        WHERE user_id = ? AND timestamp > datetime('now', ?)
    """, (user_id, f'-{days_back} days'))
```

### 2. 语义标签索引（DAG-Tag）

用LLM为每个记忆生成标签，建立标签间的层次关系，实现**子线性检索**。

```python
# 为记忆生成标签
tags_prompt = f"为这段对话生成3-5个关键词标签：{summary}"
tags = llm.complete(tags_prompt)

# 按标签索引
# 查询时先定位标签，再检索具体记忆
```

### 3. 经验记忆（LightSearcher）

北邮团队提出的LightSearcher框架，让Agent从历史成功/失败轨迹中学习，减少工具调用39.6%，推理时间缩短48.6%。

```python
# 收集成功案例
successful_patterns = [
    {"query_type": "时间查询", "effective_tags": ["time", "schedule"]},
    {"query_type": "事实查询", "effective_strategy": "BM25优先"}
]

# 下次遇到同类查询时参考
```

---

## 📊 方案对比与选型建议

| 层次 | 技术 | 实现难度 | 效果提升 | 推荐指数 |
|------|------|----------|----------|----------|
| **基础版** | 纯向量检索 | ⭐ | 基准 | 起点 |
| **进阶版** | 混合检索+重排序 | ⭐⭐ | **+20%** | ⭐⭐⭐⭐⭐ |
| **高阶版** | +时序索引 | ⭐⭐⭐ | 速度+47倍 | ⭐⭐⭐⭐ |
| **研究版** | +经验学习 | ⭐⭐⭐⭐ | 工具调用-39.6% | ⭐⭐ |

**我的建议**：先实现**进阶版（混合检索+重排序）**，这是性价比最高的方案。运行稳定后，根据你的场景特点（是否对时间敏感？是否有多跳推理？）再考虑是否加入时序索引或经验学习。

---

## ✅ 总结：你的行动路线

1. **存储层**：SQLite + 摘要存储（立即做）
2. **检索层**：nomic-embed-text（你已经熟悉）做稠密检索 + BM25做稀疏检索（本周做）
3. **重排序**：集成cross-encoder模型（下周做）
4. **生成层**：优化Prompt模板，让LLM善用记忆（同步做）
5. **进阶**：根据效果数据，决定是否加入时序/标签索引

这个方案完全基于你现有的技术栈（nomic-embed-text、Ollama、轻量级模型），不需要换模型，不需要大改架构，**只需在检索层加两道工序**，就能让你的Agent记忆系统性能大幅提升。

需要我帮你细化某个环节的具体实现代码吗？比如如何集成到你的现有Agent框架中？