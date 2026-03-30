import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import { ConversationMessage, ConversationSummary } from "@/src/types";

interface HistoryPanelProps {
  activeConversationId: string | null;
  onConversationSelect: (conversationId: string | null) => Promise<void>;
}

export default function HistoryPanel({
  activeConversationId,
  onConversationSelect,
}: HistoryPanelProps) {
  const api_base_url = import.meta.env.VITE_API_BASE_URL || "/api";
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error_msg, set_error_msg] = useState("");

  const selectedConversation = useMemo(
    () => history.find((item) => item.id === activeConversationId) ?? null,
    [history, activeConversationId],
  );

  const load_history = async (keepError = false) => {
    setLoading(true);
    if (!keepError) set_error_msg("");
    try {
      const response = await fetch(`${api_base_url}/conversations?limit=100`);
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt}`);
      }
      const data = (await response.json()) as ConversationSummary[];
      setHistory(data);
      if (!activeConversationId && data[0]) {
        await onConversationSelect(data[0].id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set_error_msg(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load_history();
  }, [api_base_url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const load_messages = async () => {
      if (!activeConversationId) {
        setMessages([]);
        return;
      }
      setLoadingMessages(true);
      try {
        const response = await fetch(
          `${api_base_url}/conversations/${activeConversationId}/messages?limit=200`,
        );
        if (!response.ok) {
          const txt = await response.text();
          throw new Error(`HTTP ${response.status}: ${txt}`);
        }
        const data = (await response.json()) as ConversationMessage[];
        setMessages(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set_error_msg(msg);
      } finally {
        setLoadingMessages(false);
      }
    };
    void load_messages();
  }, [activeConversationId, api_base_url]);

  const handleClear = () => {
    if (confirm("确定要删除所有会话吗？此操作不可恢复。")) {
      void (async () => {
        setLoading(true);
        set_error_msg("");
        try {
          const response = await fetch(`${api_base_url}/conversations`, {
            method: "DELETE",
          });
          if (!response.ok) {
            const txt = await response.text();
            throw new Error(`HTTP ${response.status}: ${txt}`);
          }
          setHistory([]);
          setMessages([]);
          await onConversationSelect(null);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          set_error_msg(msg);
        } finally {
          setLoading(false);
        }
      })();
    }
  };

  const handleDeleteOne = async (
    event: React.MouseEvent<HTMLButtonElement>,
    conversationId: string,
  ) => {
    event.stopPropagation();
    set_error_msg("");
    try {
      const response = await fetch(`${api_base_url}/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt}`);
      }
      const nextHistory = history.filter((item) => item.id !== conversationId);
      setHistory(nextHistory);
      if (activeConversationId === conversationId) {
        const next = nextHistory[0]?.id ?? null;
        await onConversationSelect(next);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set_error_msg(msg);
    }
  };

  return (
    <div className="h-full bg-paper text-ink overflow-y-auto scrollbar-none pt-24 pb-12 px-6">
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border-ink/10 pb-6">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">History</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">Recent Conversations</p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                void load_history();
              }}
              disabled={loading}
              className="p-2 text-ink/20 hover:text-ink transition-colors disabled:opacity-40"
            >
              <RefreshCw size={16} />
            </button>
            <button 
              onClick={handleClear}
              disabled={loading || history.length === 0}
              className="p-2 text-ink/20 hover:text-red-500 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </header>

        {error_msg && (
          <div className="text-xs text-red-500/80 -mt-8">加载失败：{error_msg}</div>
        )}

        {/* Timeline List */}
        <div className="space-y-12 relative">
          <div className="absolute left-0 top-0 bottom-0 w-px bg-ink/5 ml-[5px]" />
          
          {history.map((item) => (
            <motion.div 
              key={item.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className={cn(
                "relative pl-8 group cursor-pointer rounded-xl p-2",
                activeConversationId === item.id && "bg-ink/5",
              )}
              onClick={() => {
                void onConversationSelect(item.id);
              }}
            >
              {/* Dot */}
              <div className={cn(
                "absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full transition-all duration-500",
                activeConversationId === item.id
                  ? "bg-ink"
                  : "bg-ink/20 group-hover:bg-ink",
              )} />
              
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-mono text-ink/10">
                    {new Date(item.updated_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-ink/20 flex items-center gap-1">
                      <MessageSquare size={10} />
                      {item.message_count}
                    </span>
                    <button
                      onClick={(event) => {
                        void handleDeleteOne(event, item.id);
                      }}
                      className="p-1 text-ink/15 hover:text-red-500 transition-colors"
                      title="删除会话"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <h3 className="text-sm font-bold text-ink/60 group-hover:text-ink transition-colors leading-relaxed">
                  {item.title?.trim() || "未命名会话"}
                </h3>
                <p className="text-xs text-ink/30 line-clamp-2 leading-relaxed">
                  {item.last_message_preview?.trim() || "暂无消息"}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {!loading && history.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-ink/10 space-y-4">
            <Clock size={48} strokeWidth={1} />
            <span className="text-xs font-bold uppercase tracking-widest">No history found</span>
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-ink/20 py-4">
            <RefreshCw size={14} className="animate-spin" />
            <span className="text-xs uppercase tracking-widest font-bold">Loading...</span>
          </div>
        )}
        </section>

        <section className="space-y-4">
          <header className="border-b border-border-ink/10 pb-4">
            <h3 className="text-lg font-bold text-ink">会话详情</h3>
            <p className="text-xs text-ink/30 mt-1">
              {selectedConversation?.title?.trim() || "未选择会话"}
            </p>
          </header>
          <div className="rounded-2xl border border-border-ink/20 p-4 min-h-[420px] max-h-[60vh] overflow-y-auto space-y-3">
            {loadingMessages && (
              <div className="text-xs text-ink/20">正在加载消息...</div>
            )}
            {!loadingMessages && !activeConversationId && (
              <div className="text-xs text-ink/20">请选择左侧会话查看详情。</div>
            )}
            {!loadingMessages && activeConversationId && messages.length === 0 && (
              <div className="text-xs text-ink/20">该会话暂无消息。</div>
            )}
            {!loadingMessages &&
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm",
                    msg.role === "user"
                      ? "bg-mist/50 border border-border-ink/20 ml-8"
                      : "bg-ink/[0.02] mr-8",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-ink/30 mb-1">
                    {msg.role}
                  </div>
                  <div className="text-ink/80 whitespace-pre-wrap">{msg.content}</div>
                </div>
              ))}
          </div>
        </section>

      </div>
    </div>
  );
}
