import React, { useState } from "react";
import { Search, Filter, Database, ChevronDown, ChevronUp, Info, Activity, MessageCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import { VectorResult } from "@/src/types";

export default function VectorDBPanel() {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const [results, setResults] = useState<VectorResult[]>([
    {
      id: "v1",
      type: "最近对话",
      summary: "用户提到喜欢深色模式，并询问了 React 19 的新特性。",
      scores: { vector: 0.85, typeWeight: 0.1, timeDecay: 0.95, keywordBonus: 0.05, final: 0.92 }
    },
    {
      id: "v2",
      type: "Aris 行为",
      summary: "当用户表达沮丧时，Aris 应该提供情感支持并尝试引导积极讨论。",
      scores: { vector: 0.78, typeWeight: 0.2, timeDecay: 0.88, keywordBonus: 0.1, final: 0.85 }
    },
    {
      id: "v3",
      type: "用户喜好",
      summary: "用户偏好简洁的技术文档，不喜欢冗长的解释。",
      scores: { vector: 0.72, typeWeight: 0.15, timeDecay: 0.9, keywordBonus: 0.0, final: 0.78 }
    }
  ]);

  return (
    <div className="h-full bg-paper text-ink overflow-y-auto scrollbar-none pt-24 pb-12 px-6">
      <div className="max-w-2xl mx-auto space-y-16">
        {/* Header & Search */}
        <header className="space-y-8">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">Vector DB</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">Semantic Retrieval Engine</p>
          </div>

          <div className="space-y-6">
            <div className="relative group">
              <Search size={18} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink/10 group-focus-within:text-ink/40 transition-colors" />
              <input 
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search semantic memory..."
                className="w-full bg-transparent border-b border-border-ink/50 pl-8 py-4 text-sm focus:border-ink transition-all outline-none placeholder:text-ink/10"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button className="text-[10px] font-black uppercase tracking-widest text-ink/20 hover:text-ink transition-colors">Recent</button>
                <button className="text-[10px] font-black uppercase tracking-widest text-ink/20 hover:text-ink transition-colors">Aris</button>
                <button className="text-[10px] font-black uppercase tracking-widest text-ink/20 hover:text-ink transition-colors">User</button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-ink/10">Limit</span>
                <input 
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value))}
                  className="w-8 bg-transparent border-none text-[10px] font-mono text-ink/40 focus:ring-0 p-0 text-center"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Results List */}
        <div className="space-y-12">
          {results.map((res) => (
            <motion.div 
              key={res.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group space-y-4"
            >
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] text-ink/20">
                      {res.type}
                    </span>
                    <div className="w-1 h-1 bg-ink/5 rounded-full" />
                    <span className="text-[9px] font-mono text-ink/5">ID: {res.id}</span>
                  </div>
                  <p className="text-sm text-ink/60 leading-relaxed group-hover:text-ink transition-colors">
                    {res.summary}
                  </p>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-xl font-black text-ink/80 leading-none">
                    {(res.scores.final * 100).toFixed(0)}
                  </span>
                  <span className="text-[8px] font-black uppercase tracking-widest text-ink/10 mt-1">Score</span>
                </div>
              </div>

              {/* Score Breakdown (Subtle) */}
              <div className="grid grid-cols-4 gap-8 pt-4 border-t border-border-ink/5 opacity-40 group-hover:opacity-100 transition-opacity">
                <ScoreItem label="Vector" value={res.scores.vector} />
                <ScoreItem label="Type" value={res.scores.typeWeight} />
                <ScoreItem label="Decay" value={res.scores.timeDecay} />
                <ScoreItem label="Bonus" value={res.scores.keywordBonus} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScoreItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] text-gray-400 uppercase font-bold mb-1.5">{label}</span>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${value * 100}%` }}
            className="h-full bg-ink"
          />
        </div>
        <span className="text-[9px] font-mono text-gray-500">{value.toFixed(2)}</span>
      </div>
    </div>
  );
}

function MetadataBlock() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-mist hover:bg-gray-200 border border-border-ink rounded-full text-[10px] text-gray-500 font-bold uppercase tracking-tighter transition-all"
      >
        <Info size={12} />
        检索元数据
        {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute top-full mt-2 left-0 w-80 bg-paper border border-border-ink rounded-2xl shadow-2xl p-5 z-10"
          >
            <div className="space-y-4">
              <div>
                <span className="text-[9px] text-gray-400 uppercase font-bold block mb-1.5">智能 Query 改写</span>
                <div className="p-3 bg-mist rounded-xl border border-border-ink text-[11px] font-mono text-gray-500 leading-relaxed italic">
                  "用户喜欢深色模式" → "user preference UI theme dark mode visual style"
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[9px] text-gray-400 uppercase font-bold block mb-1">Model</span>
                  <span className="text-[11px] text-ink font-medium">text-embedding-3</span>
                </div>
                <div>
                  <span className="text-[9px] text-gray-400 uppercase font-bold block mb-1">Metric</span>
                  <span className="text-[11px] text-ink font-medium">Cosine</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
