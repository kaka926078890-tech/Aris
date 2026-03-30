import React, { useEffect, useState } from "react";
import { 
  MessageSquare, 
  History, 
  Database, 
  UserCircle, 
  Brain, 
  BarChart3, 
  Terminal, 
  Settings as SettingsIcon,
  Cpu,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Menu,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import { Panel } from "@/src/types";

// Panels
import ChatPanel from "@/src/components/panels/ChatPanel";
import HistoryPanel from "@/src/components/panels/HistoryPanel";
import VectorDBPanel from "@/src/components/panels/VectorDBPanel";
import UserArisPanel from "@/src/components/panels/UserArisPanel";
import MemoryPanel from "@/src/components/panels/MemoryPanel";
import MonitoringPanel from "@/src/components/panels/MonitoringPanel";
import PromptPreviewPanel from "@/src/components/panels/PromptPreviewPanel";
import SettingsPanel from "@/src/components/panels/SettingsPanel";

function parsePanelFromHash(hash: string): Panel | null {
  const key = hash.replace(/^#\/?/, "").split("?")[0];
  return (Object.values(Panel) as string[]).includes(key) ? (key as Panel) : null;
}

export default function App() {
  const api_base_url = import.meta.env.VITE_API_BASE_URL || "/api";
  const [activePanel, setActivePanel] = useState<Panel>(() => {
    if (typeof window === "undefined") return Panel.Chat;
    return parsePanelFromHash(window.location.hash) ?? Panel.Chat;
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    const loadCurrentConversation = async () => {
      try {
        const response = await fetch(`${api_base_url}/conversations/current`);
        if (!response.ok) return;
        const data = (await response.json()) as { conversation_id: string | null };
        setActiveConversationId(data.conversation_id);
      } catch {
        setActiveConversationId(null);
      }
    };
    void loadCurrentConversation();
  }, [api_base_url]);

  useEffect(() => {
    const onHashChange = () => {
      const parsed = parsePanelFromHash(window.location.hash);
      if (parsed) setActivePanel(parsed);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const expected = `#/${activePanel}`;
    if (window.location.hash === expected) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${expected}`,
    );
  }, [activePanel]);

  const updateCurrentConversation = async (conversationId: string | null) => {
    setActiveConversationId(conversationId);
    try {
      await fetch(`${api_base_url}/conversations/current`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
    } catch {
      // Ignore sync errors here; each panel handles reload errors independently.
    }
  };

  const mainNavItems = [
    { id: Panel.Chat, icon: <MessageSquare size={20} />, label: "对话" },
    { id: Panel.History, icon: <History size={20} />, label: "历史" },
    { id: Panel.Prompt, icon: <Terminal size={20} />, label: "提示词" },
    { id: Panel.Settings, icon: <SettingsIcon size={20} />, label: "设置" },
  ];

  const advancedNavItems = [
    { id: Panel.VectorDB, icon: <Database size={18} />, label: "向量库" },
    { id: Panel.UserAris, icon: <UserCircle size={18} />, label: "用户画像" },
    { id: Panel.Memory, icon: <Brain size={18} />, label: "语义记忆" },
    { id: Panel.Monitoring, icon: <BarChart3 size={18} />, label: "监控" },
  ];

  const renderPanel = () => {
    switch (activePanel) {
      case Panel.Chat:
        return (
          <ChatPanel
            conversationId={activeConversationId}
            onConversationChange={updateCurrentConversation}
          />
        );
      case Panel.History:
        return (
          <HistoryPanel
            activeConversationId={activeConversationId}
            onConversationSelect={updateCurrentConversation}
          />
        );
      case Panel.VectorDB: return <VectorDBPanel />;
      case Panel.UserAris: return <UserArisPanel />;
      case Panel.Memory: return <MemoryPanel />;
      case Panel.Monitoring: return <MonitoringPanel />;
      case Panel.Prompt: return <PromptPreviewPanel />;
      case Panel.Settings: return <SettingsPanel />;
      default:
        return (
          <ChatPanel
            conversationId={activeConversationId}
            onConversationChange={updateCurrentConversation}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-paper text-ink font-sans selection:bg-ink/10 overflow-hidden">
      {/* Sidebar - Now a floating drawer or minimal strip */}
      <AnimatePresence>
        {!isSidebarCollapsed && (
          <motion.div 
            initial={{ x: -260 }}
            animate={{ x: 0 }}
            exit={{ x: -260 }}
            className="fixed inset-y-0 left-0 w-64 bg-mist border-r border-border-ink z-50 shadow-2xl flex flex-col"
          >
            {/* Sidebar Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border-ink">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-ink rounded-lg flex items-center justify-center shadow-sm">
                  <Cpu size={18} className="text-white" />
                </div>
                <span className="font-bold text-lg tracking-tight text-ink">Aris <span className="text-ink/40">v2</span></span>
              </div>
              <button 
                onClick={() => setIsSidebarCollapsed(true)}
                className="p-1 hover:bg-ink/5 rounded-md text-ink/40 hover:text-ink transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto scrollbar-none">
              {mainNavItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActivePanel(item.id);
                    setIsSidebarCollapsed(true);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-200 group relative",
                    activePanel === item.id 
                      ? "bg-ink text-paper shadow-sm" 
                      : "text-ink/40 hover:text-ink hover:bg-ink/5"
                  )}
                >
                  <div className="shrink-0">{item.icon}</div>
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              ))}

              <div className="pt-6 pb-2">
                <button 
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="w-full flex items-center justify-between px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-ink/20 hover:text-ink/40 transition-colors"
                >
                  <span>Advanced</span>
                  <div className={cn("transition-transform", showAdvanced && "rotate-180")}>
                    <ChevronDown size={12} />
                  </div>
                </button>
              </div>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-1"
                  >
                    {advancedNavItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActivePanel(item.id);
                          setIsSidebarCollapsed(true);
                        }}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group relative",
                          activePanel === item.id 
                            ? "bg-ink/10 text-ink" 
                            : "text-ink/30 hover:text-ink/60 hover:bg-ink/5"
                        )}
                      >
                        <div className="shrink-0">{item.icon}</div>
                        <span className="text-xs font-medium">{item.label}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </nav>

            {/* Bottom Info */}
            <div className="p-4 border-t border-border-ink bg-mist">
              <div className="flex items-center gap-3 p-3 bg-paper rounded-xl border border-border-ink">
                <div className="w-8 h-8 rounded-full bg-ink flex items-center justify-center text-[10px] font-bold text-paper">
                  K
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-xs font-semibold truncate text-ink">Kaka</span>
                  <span className="text-[10px] text-ink/40 truncate">kaka926078890@gmail.com</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Toggle Button (Floating) */}
      <button 
        onClick={() => setIsSidebarCollapsed(false)}
        className={cn(
          "fixed top-6 left-6 z-40 p-2.5 bg-paper/80 backdrop-blur-md border border-border-ink/50 rounded-full text-ink/40 hover:text-ink hover:shadow-lg transition-all active:scale-95",
          !isSidebarCollapsed && "opacity-0 pointer-events-none"
        )}
      >
        <ChevronRight size={20} />
      </button>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Content Area */}
        <div className="flex-1 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={activePanel}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute inset-0"
            >
              {renderPanel()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
