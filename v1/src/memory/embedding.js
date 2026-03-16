const OLLAMA_EMBED_URL = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace('localhost', '127.0.0.1');
const EMBED_MODEL = process.env.ARIS_EMBED_MODEL || 'nomic-embed-text';

function normalizeEmbeddingResponse(data) {
  if (!data) return null;
  // Ollama variants / clients may return different shapes.
  // - { embedding: number[] }
  // - { embeddings: [number[]] }
  // - { data: [{ embedding: number[] }] } (OpenAI-like)
  const emb =
    data.embedding ??
    (Array.isArray(data.embeddings) ? data.embeddings[0] : null) ??
    (Array.isArray(data.data) ? data.data?.[0]?.embedding : null);
  return Array.isArray(emb) && emb.length > 0 ? emb : null;
}

async function embed(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const input = text.trim();
  try {
    console.info(`[Aris][embed] request: model=${EMBED_MODEL} host=${OLLAMA_EMBED_URL} inputLen=${input.length}`);

    // Ollama's embeddings API commonly expects { prompt }, not { input }.
    // Some versions also support /api/embed with { input }.
    const attempts = [
      { url: `${OLLAMA_EMBED_URL}/api/embeddings`, body: { model: EMBED_MODEL, prompt: input } },
      { url: `${OLLAMA_EMBED_URL}/api/embeddings`, body: { model: EMBED_MODEL, input } },
      { url: `${OLLAMA_EMBED_URL}/api/embed`, body: { model: EMBED_MODEL, input } },
    ];

    let lastErr = null;
    for (const a of attempts) {
      try {
        const res = await fetch(a.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a.body),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`${a.url} ${res.status}: ${t}`);
        }
        const data = await res.json();
        const vec = normalizeEmbeddingResponse(data);
        if (vec) {
          console.info(`[Aris][embed] response: ok=true dim=${vec.length}`);
          return vec;
        }
        lastErr = new Error(`${a.url}: empty embedding`);
      } catch (e) {
        lastErr = e;
      }
    }

    console.info('[Aris][embed] response: ok=false dim=0');
    throw lastErr || new Error('Empty embedding');
  } catch (e) {
    const msg = e.message || String(e);
    const isConnection = /fetch failed|ECONNREFUSED|connect|network/i.test(msg);
    if (isConnection) {
      console.warn(
        '[Aris] 无法连接 Ollama 服务。请先让 Ollama 保持运行：' +
        '菜单栏打开 Ollama 应用，或在终端执行 ollama serve 并保持该终端窗口打开。'
      );
    } else {
      console.warn(`[Aris] Embedding failed: ${msg}`);
    }
    return null;
  }
}

module.exports = { embed };
