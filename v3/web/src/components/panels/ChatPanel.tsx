import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Send, Terminal, Wrench } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/src/lib/utils";
import { ChatApiResponse, ConversationMessage, Message, ToolTraceRound } from "@/src/types";

type ChatRenderableMessage = ConversationMessage & { role: "user" | "assistant" };

interface ChatPanelProps {
  conversationId: string | null;
  onConversationChange: (conversationId: string | null) => Promise<void>;
}

export default function ChatPanel({
  conversationId,
  onConversationChange,
}: ChatPanelProps) {
  const api_base_url = import.meta.env.VITE_API_BASE_URL || "/api";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error_msg, set_error_msg] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadConversationMessages = async () => {
      if (!conversationId) {
        setMessages([]);
        return;
      }
      setIsLoading(true);
      try {
        const msg_res = await fetch(
          `${api_base_url}/conversations/${conversationId}/messages?limit=10&newest_first=true`,
        );
        if (!msg_res.ok) {
          const txt = await msg_res.text();
          throw new Error(`HTTP ${msg_res.status}: ${txt}`);
        }

        const raw_msgs = (await msg_res.json()) as ConversationMessage[];
        const recent_msgs = raw_msgs
          .filter(
            (m): m is ChatRenderableMessage =>
              m.role === "user" || m.role === "assistant",
          )
          .reverse()
          .map(
            (m): Message => ({
              id: m.id,
              role: m.role,
              content: m.content,
              tool_trace: parseToolTraceFromMeta(m.metadata),
              timestamp: new Date(m.created_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }),
          );

        set_error_msg("");
        setMessages(recent_msgs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set_error_msg(msg);
        setMessages([]);
      } finally {
        setIsLoading(false);
      }
    };

    void loadConversationMessages();
  }, [api_base_url, conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;
    if (isTyping) return;

    const content = input.trim();
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    set_error_msg("");
    setIsTyping(true);

    try {
      const body: { message: string; conversation_id?: string } = { message: content };
      if (conversationId) body.conversation_id = conversationId;
      console.log("[aris_web][chat_request]", body);

      const response = await fetch(`${api_base_url}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`HTTP ${response.status}: ${txt}`);
      }

      const data = (await response.json()) as ChatApiResponse;
      console.log("[aris_web][chat_response]", data);
      if (data.conversation_id !== conversationId) {
        await onConversationChange(data.conversation_id);
      }

      const aiMsgId = data.message.id;
      const aiMsg: Message = {
        id: data.message.id,
        role: "assistant",
        content: "",
        tool_trace: data.tool_trace,
        timestamp: new Date(data.message.created_at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, aiMsg]);
      await streamAssistantContent(aiMsgId, data.message.content, setMessages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[aris_web][chat_error]", err);
      set_error_msg(msg);
      const failMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `请求失败：${msg}`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, failMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    const native = e.nativeEvent as KeyboardEvent;
    if (native.isComposing || native.keyCode === 229) return;
    e.preventDefault();
    setTimeout(() => {
      void handleSend();
    }, 0);
  };

  return (
    <div className="flex flex-col h-full bg-paper text-ink relative overflow-hidden">
      {/* Message Stream */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto pt-10 pb-4 px-6 scrollbar-none"
      >
        <div className="max-w-2xl mx-auto space-y-5">
          {messages.map((msg) => (
            <motion.div 
              key={msg.id} 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={cn(
                "flex flex-col w-full group",
                msg.role === "user" ? "items-end" : "items-start"
              )}
            >
              {msg.role === "assistant" && hasRealToolUsage(msg.tool_trace) && (
                <div className="mb-2 w-full max-w-[90%] border border-border-ink/30 rounded-xl p-3 bg-mist/40">
                  <div className="text-xs text-ink/60 flex items-center gap-2 mb-2">
                    <Wrench size={12} />
                    工具调用流水线（{msg.tool_trace?.filter((r) => r.used_tools).length || 0} 轮）
                  </div>
                  <div className="space-y-2">
                    {msg.tool_trace?.filter((round) => round.used_tools).map((round) => (
                      <div key={`${msg.id}-round-${round.round}`} className="text-[11px] font-mono text-ink/60 bg-paper/70 p-2 rounded-lg">
                        <div>round={round.round} used_tools={String(round.used_tools)}</div>
                        {round.tool_calls.map((call, idx) => (
                          <div key={`${msg.id}-${round.round}-${idx}`} className="mt-1">
                            <div>tool={call.tool_name}</div>
                            <div>args={JSON.stringify(call.tool_args)}</div>
                            <div>result={JSON.stringify(call.tool_result)}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div 
                className={cn(
                  "max-w-[90%] transition-all",
                  msg.role === "user" 
                    ? "bg-mist/50 border border-border-ink/20 px-6 py-4 rounded-[32px] text-ink shadow-sm" 
                    : "bg-transparent text-ink leading-relaxed"
                )}
              >
                <div className={cn(
                  "prose prose-sm max-w-none text-ink selection:bg-ink/10",
                  msg.role === "assistant" ? "text-[16px] leading-[1.65] font-medium" : "text-[15px]"
                )}>
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              </div>

              {/* Meta Info (Hover) */}
              <div className={cn(
                "flex items-center gap-3 mt-2 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              )}>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/10">
                  {msg.role === "user" ? "You" : "Aris"}
                </span>
                <span className="text-[10px] font-mono text-ink/5">
                  {msg.timestamp}
                </span>
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <div className="text-xs text-ink/20 px-2">正在加载会话...</div>
          )}
          {!isTyping && !isLoading && messages.length === 0 && !error_msg && (
            <div className="text-xs text-ink/20 px-2">暂无历史消息，输入后将开始新会话。</div>
          )}

          {isTyping && (
            <div className="flex items-center gap-2 text-ink/10 p-4">
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }} 
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-1.5 h-1.5 bg-current rounded-full" 
              />
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }} 
                transition={{ repeat: Infinity, duration: 1, delay: 0.2 }}
                className="w-1.5 h-1.5 bg-current rounded-full" 
              />
              <motion.div 
                animate={{ scale: [1, 1.2, 1] }} 
                transition={{ repeat: Infinity, duration: 1, delay: 0.4 }}
                className="w-1.5 h-1.5 bg-current rounded-full" 
              />
            </div>
          )}
          {error_msg && (
            <div className="text-xs text-red-500/80 px-2">后端连接异常：{error_msg}</div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Bottom Input Area (in normal flow, avoid covering messages) */}
      <div className="w-full max-w-2xl mx-auto px-6 pb-6 pt-2">
        <div className="relative flex flex-col bg-paper/88 backdrop-blur-2xl rounded-[28px] border border-border-ink/30 shadow-xl p-2 group focus-within:border-ink/20 transition-all duration-300">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入你想说的话..."
            className="w-full bg-transparent border-none focus:ring-0 outline-none py-3 px-5 text-[15px] min-h-[52px] max-h-44 resize-none scrollbar-none text-ink placeholder:text-ink/20"
            rows={1}
          />
          <div className="flex items-center justify-between px-4 pb-1">
            <div className="flex items-center gap-4">
              <button className="p-2 text-ink/10 hover:text-ink/30 transition-colors">
                <Terminal size={18} />
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className={cn(
                "p-4 rounded-full transition-all duration-500 shadow-lg active:scale-90",
                input.trim() 
                  ? "bg-ink text-paper scale-100 hover:shadow-ink/20" 
                  : "bg-ink/5 text-ink/10 scale-90 opacity-50"
              )}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
        <div className="mt-2 text-center">
          <span className="text-[9px] font-black uppercase tracking-[0.3em] text-ink/5">
            Aris v3 • Web Connected
          </span>
        </div>
      </div>
    </div>
  );
}

function parseToolTraceFromMeta(meta: Record<string, unknown> | null): ToolTraceRound[] | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const value = (meta as Record<string, unknown>).tool_trace;
  if (!Array.isArray(value)) return undefined;
  return value as ToolTraceRound[];
}

function hasRealToolUsage(trace: ToolTraceRound[] | undefined): boolean {
  if (!trace || trace.length === 0) return false;
  return trace.some((round) => round.used_tools && round.tool_calls.length > 0);
}

async function streamAssistantContent(
  messageId: string,
  fullText: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
): Promise<void> {
  for (let i = 1; i <= fullText.length; i++) {
    const next = fullText.slice(0, i);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? {
              ...msg,
              content: next,
            }
          : msg,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}
