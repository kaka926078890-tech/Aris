import React, { useMemo, useState } from "react";
import { Play, Copy, Terminal, MessageSquare, Info, Check } from "lucide-react";
import { PromptPreviewResponse } from "@/src/types";

export default function PromptPreviewPanel() {
  const api_base_url = import.meta.env.VITE_API_BASE_URL || "/api";
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<PromptPreviewResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error_msg, set_error_msg] = useState("");
  const [viewMode, setViewMode] = useState<"readable" | "json">("json");

  const previewText = useMemo(() => {
    if (!preview) return "";
    return preview.trace.messages
      .map((msg, idx) => `[${idx + 1}] ${msg.role.toUpperCase()}\n${msg.content}`)
      .join("\n\n");
  }, [preview]);
  const previewJsonText = useMemo(() => {
    if (!preview) return "";
    const payload = {
      model: "deepseek-chat",
      messages: preview.trace.messages,
      token_usage: preview.trace.token_usage,
      conversation_id: preview.conversation_id,
    };
    return JSON.stringify(payload, null, 2);
  }, [preview]);

  const handlePreview = async () => {
    setLoading(true);
    set_error_msg("");
    try {
      const response = await fetch(`${api_base_url}/chat/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input }),
      });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt}`);
      }
      const data = (await response.json()) as PromptPreviewResponse;
      setPreview(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set_error_msg(msg);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(viewMode === "json" ? previewJsonText : previewText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full bg-paper text-ink p-6 space-y-6 overflow-y-auto scrollbar-thin">
      <div className="flex items-center justify-between ml-14">
        <h2 className="text-sm font-semibold text-ink/50 uppercase tracking-wider flex items-center gap-2">
          <Terminal size={16} />
          提示词预览
        </h2>
        <div className="flex items-center gap-4 p-3 bg-mist border border-border-ink/10 rounded-xl">
          <Info size={16} className="text-ink/40 shrink-0" />
          <p className="text-[11px] text-ink/60">
            此面板用于模拟用户输入并预览最终发送给 AI 的完整提示词。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
        {/* Input Section */}
        <div className="flex flex-col space-y-4">
          <div className="flex-1 bg-white border border-border-ink/10 rounded-2xl shadow-sm p-6 space-y-4 flex flex-col">
            <div className="flex items-center gap-2 text-xs font-medium text-ink/50">
              <MessageSquare size={14} />
              模拟用户消息 (可选)
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入模拟消息以查看其在提示词中的位置..."
              className="flex-1 bg-mist/30 border border-border-ink/10 rounded-xl p-4 text-sm font-mono leading-relaxed resize-none focus:border-ink/30 transition-all scrollbar-thin outline-none"
            />
            <button 
              onClick={handlePreview}
              className="w-full py-3 bg-ink text-paper hover:bg-ink/90 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-sm active:scale-95"
            >
              <Play size={16} />
              生成预览
            </button>
          </div>
        </div>

        {/* Preview Section */}
        <div className="flex flex-col space-y-4">
          <div className="flex-1 bg-white border border-border-ink/10 rounded-2xl shadow-sm p-6 space-y-4 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between text-xs font-medium text-ink/50">
              <div className="flex items-center gap-2">
                <Terminal size={14} />
                预览结果 ({viewMode === "json" ? "JSON Payload" : "Readable Messages"})
              </div>
              <div className="flex items-center gap-3">
                {preview && (
                  <>
                    <div className="flex items-center rounded-lg border border-border-ink/30 overflow-hidden">
                      <button
                        onClick={() => setViewMode("json")}
                        className={`px-2 py-1 ${viewMode === "json" ? "bg-ink text-paper" : "bg-paper text-ink/60"}`}
                      >
                        JSON
                      </button>
                      <button
                        onClick={() => setViewMode("readable")}
                        className={`px-2 py-1 ${viewMode === "readable" ? "bg-ink text-paper" : "bg-paper text-ink/60"}`}
                      >
                        Messages
                      </button>
                    </div>
                    <button 
                      onClick={handleCopy}
                      className="flex items-center gap-2 text-ink/70 hover:text-ink transition-colors"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "已复制" : "复制内容"}
                    </button>
                  </>
                )}
              </div>
            </div>
            {preview && (
              <div className="text-[11px] text-ink/50 bg-mist/40 border border-border-ink/10 rounded-lg p-3 space-y-1">
                <div>会话: {preview.conversation_id || "无（仅 system + 当前输入）"}</div>
                <div>
                  Tokens - system: {preview.trace.token_usage.system}, memory:{" "}
                  {preview.trace.token_usage.memory}, user: {preview.trace.token_usage.user}, total:{" "}
                  {preview.trace.token_usage.total}
                </div>
              </div>
            )}
            {error_msg && (
              <div className="text-xs text-red-500/80">预览失败：{error_msg}</div>
            )}
            <div className="flex-1 bg-mist/30 border border-border-ink/10 rounded-xl p-4 overflow-y-auto scrollbar-thin">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center text-ink/20 space-y-4">
                  <Terminal size={48} strokeWidth={1} />
                  <span className="text-sm">正在请求真实提示词...</span>
                </div>
              ) : preview ? (
                <pre className="text-xs font-mono text-ink/70 leading-relaxed whitespace-pre-wrap">
                  {viewMode === "json" ? previewJsonText : previewText}
                </pre>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-ink/20 space-y-4">
                  <Terminal size={48} strokeWidth={1} />
                  <span className="text-sm">点击左侧按钮生成预览</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
