import React, { useState } from "react";
import { Save, Info, FileText, AlertTriangle, Heart, Ban } from "lucide-react";
import { cn } from "@/src/lib/utils";

type Tab = "requirements" | "corrections" | "preferences" | "forbidden";

export default function MemoryPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("requirements");
  const [content, setContent] = useState({
    requirements: "1. 回复请保持简洁\n2. 优先使用 Markdown 格式\n3. 在回答技术问题时提供代码示例",
    corrections: "1. 修正了关于 React 19 的描述\n2. 用户指出向量检索偏差",
    preferences: "1. 喜欢深色模式\n2. 偏好 TypeScript 示例",
    forbidden: "不要使用过于口语化的表达\n不要在回答中包含广告内容\n不要泄露用户的个人隐私信息",
  });

  const tabs = [
    { id: "requirements", label: "用户要求", icon: <FileText size={14} />, desc: "用户对 Aris 的直接要求，影响回复风格。" },
    { id: "corrections", label: "纠错记录", icon: <AlertTriangle size={14} />, desc: "用户对 Aris 错误回复的修正记录。" },
    { id: "preferences", label: "用户喜好", icon: <Heart size={14} />, desc: "从对话中自动提取的用户偏好。" },
    { id: "forbidden", label: "禁止用语", icon: <Ban size={14} />, desc: "Aris 在回复中必须避免使用的词汇或短语。" },
  ];

  const handleSave = () => {
    // alert is forbidden, using console for now or just a state change
    console.log(`已保存 ${tabs.find(t => t.id === activeTab)?.label}，正在触发 AI 总结刷新...`);
  };

  return (
    <div className="h-full bg-paper text-ink overflow-y-auto scrollbar-none pt-24 pb-12 px-6">
      <div className="max-w-2xl mx-auto space-y-16">
        {/* Header & Tabs */}
        <header className="space-y-8">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">Memory</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">Long-term Context & Constraints</p>
          </div>

          <div className="flex items-center gap-6 overflow-x-auto scrollbar-none pb-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as Tab)}
                className={cn(
                  "text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                  activeTab === tab.id 
                    ? "text-ink border-b-2 border-ink pb-1" 
                    : "text-ink/20 hover:text-ink/40"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        {/* Content Area */}
        <div className="space-y-12">
          <div className="flex items-start gap-4 opacity-40 hover:opacity-100 transition-opacity">
            <Info size={14} className="text-ink mt-0.5 shrink-0" />
            <p className="text-[11px] text-ink leading-relaxed font-medium">
              {tabs.find(t => t.id === activeTab)?.desc}
            </p>
          </div>

          <div className="space-y-8">
            <textarea
              value={content[activeTab]}
              onChange={(e) => setContent({ ...content, [activeTab]: e.target.value })}
              className="w-full bg-transparent border-none focus:ring-0 p-0 text-sm font-mono leading-relaxed resize-none min-h-[300px] outline-none placeholder:text-ink/5"
              placeholder="Enter memory content..."
            />
            
            <div className="flex items-center justify-between pt-8 border-t border-border-ink/5">
              <span className="text-[9px] font-black uppercase tracking-widest text-ink/10">
                {activeTab === "forbidden" ? "One per line" : "Auto-summarized on save"}
              </span>
              <button 
                onClick={handleSave}
                className="text-[10px] font-black uppercase tracking-widest text-ink/40 hover:text-ink transition-colors flex items-center gap-2"
              >
                <Save size={14} />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
