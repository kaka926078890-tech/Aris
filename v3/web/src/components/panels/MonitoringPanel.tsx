import React, { useState } from "react";
import { BarChart3, FileEdit, Search, Calendar, Filter, ArrowUpRight, ArrowDownRight, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { TokenStat, FileChange } from "@/src/types";

export default function MonitoringPanel() {
  const [activeTab, setActiveTab] = useState<"tokens" | "files">("tokens");

  return (
    <div className="flex flex-col h-full bg-paper text-ink">
      {/* Tabs */}
      <div className="flex items-center gap-1 p-3 bg-mist border-b border-border-ink">
        <button
          onClick={() => setActiveTab("tokens")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-tighter transition-all duration-200",
            activeTab === "tokens" 
              ? "bg-ink text-white shadow-sm" 
              : "text-gray-500 hover:text-ink hover:bg-paper border border-transparent hover:border-border-ink"
          )}
        >
          <BarChart3 size={14} />
          Token 统计
        </button>
        <button
          onClick={() => setActiveTab("files")}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-tighter transition-all duration-200",
            activeTab === "files" 
              ? "bg-ink text-white shadow-sm" 
              : "text-gray-500 hover:text-ink hover:bg-paper border border-transparent hover:border-border-ink"
          )}
        >
          <FileEdit size={14} />
          文件修改
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin">
        {activeTab === "tokens" ? <TokenStats /> : <FileChanges />}
      </div>
    </div>
  );
}

function TokenStats() {
  const [stats, setStats] = useState<TokenStat[]>([
    { id: "1", time: "09:00:12", session: "s123", type: "流式", input: 120, output: 450, hit: 50, miss: 70, hitRate: 0.42, inference: 300, estimated: false },
    { id: "2", time: "08:45:30", session: "s124", type: "工具", input: 80, output: 120, hit: 80, miss: 0, hitRate: 1.0, inference: 50, estimated: true },
    { id: "3", time: "08:30:15", session: "s125", type: "编排", input: 200, output: 600, hit: 100, miss: 100, hitRate: 0.5, inference: 400, estimated: false },
  ]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex items-center gap-4 bg-mist p-4 rounded-2xl border border-border-ink shadow-sm">
        <div className="flex items-center gap-2 bg-paper border border-border-ink rounded-xl px-3 py-2">
          <Calendar size={14} className="text-gray-400" />
          <input type="date" className="bg-transparent border-none focus:ring-0 text-sm p-0 text-ink outline-none" />
        </div>
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="会话 ID 搜索..." 
            className="w-full bg-paper border border-border-ink rounded-xl pl-10 pr-4 py-2 text-sm focus:border-gray-400 transition-all outline-none"
          />
        </div>
        <button className="px-4 py-2 bg-paper hover:bg-mist border border-border-ink rounded-xl text-[10px] font-bold uppercase tracking-tighter transition-all flex items-center gap-2">
          <Filter size={14} />
          筛选
        </button>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="总请求数" value="1,284" icon={<ArrowUpRight size={14} className="text-ink" />} />
        <SummaryCard label="总 Token (In/Out)" value="452k / 890k" icon={<BarChart3 size={14} className="text-ink" />} />
        <SummaryCard label="缓存命中/未命中" value="320k / 132k" icon={<CheckCircle2 size={14} className="text-ink" />} />
        <SummaryCard label="推理 Token" value="120k" icon={<AlertCircle size={14} className="text-ink" />} />
      </div>

      {/* Cache Percentage Bar */}
      <div className="bg-mist p-6 rounded-2xl border border-border-ink shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">当日缓存占比</span>
          <span className="text-sm font-black text-ink">72.4%</span>
        </div>
        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden flex">
          <div className="h-full bg-ink" style={{ width: "72.4%" }} />
          <div className="h-full bg-gray-300" style={{ width: "27.6%" }} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-mist border border-border-ink rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-paper border-b border-border-ink">
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">时间</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">会话</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">类型</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">输入</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">输出</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">命中</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">未命中</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">占比</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">推理</th>
                <th className="px-4 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">估算</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-ink">
              {stats.map((row) => (
                <tr key={row.id} className="hover:bg-paper transition-colors">
                  <td className="px-4 py-4 text-gray-500 font-mono">{row.time}</td>
                  <td className="px-4 py-4 text-ink font-medium">{row.session}</td>
                  <td className="px-4 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded uppercase text-[9px] font-bold tracking-tighter",
                      row.type === "流式" ? "bg-ink text-white" :
                      row.type === "工具" ? "bg-gray-200 text-gray-600" :
                      "bg-paper border border-border-ink text-gray-500"
                    )}>
                      {row.type}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-ink">{row.input}</td>
                  <td className="px-4 py-4 text-ink">{row.output}</td>
                  <td className="px-4 py-4 text-ink font-bold">{row.hit}</td>
                  <td className="px-4 py-4 text-gray-400">{row.miss}</td>
                  <td className="px-4 py-4 font-mono">{(row.hitRate * 100).toFixed(1)}%</td>
                  <td className="px-4 py-4 text-ink">{row.inference}</td>
                  <td className="px-4 py-4">
                    {row.estimated ? <CheckCircle2 size={14} className="text-ink" /> : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FileChanges() {
  const [changes, setChanges] = useState<FileChange[]>([
    { id: "f1", path: "/src/components/panels/ChatPanel.tsx", changes: 12, lastModified: "2026-03-27 09:00:00" },
    { id: "f2", path: "/src/lib/utils.ts", changes: 2, lastModified: "2026-03-27 08:30:00" },
    { id: "f3", path: "/src/types.ts", changes: 5, lastModified: "2026-03-27 08:45:00" },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 bg-mist p-4 rounded-2xl border border-border-ink shadow-sm">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="路径搜索..." 
            className="w-full bg-paper border border-border-ink rounded-xl pl-10 pr-4 py-2 text-sm focus:border-gray-400 transition-all outline-none"
          />
        </div>
      </div>

      <div className="bg-mist border border-border-ink rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-paper border-b border-border-ink">
              <th className="px-6 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">文件路径</th>
              <th className="px-6 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">修改次数</th>
              <th className="px-6 py-4 text-[9px] text-gray-400 uppercase font-bold tracking-widest">最后修改时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-ink">
            {changes.map((row) => (
              <tr key={row.id} className="hover:bg-paper transition-colors">
                <td className="px-6 py-4 text-ink font-mono font-medium">{row.path}</td>
                <td className="px-6 py-4">
                  <span className="px-3 py-1 bg-ink text-white rounded-lg text-[10px] font-bold uppercase tracking-tighter">
                    {row.changes} 次
                  </span>
                </td>
                <td className="px-6 py-4 text-gray-500 font-mono">{row.lastModified}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-mist p-6 rounded-2xl border border-border-ink shadow-sm space-y-3 hover:border-gray-400 transition-all group">
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">{label}</span>
        {icon}
      </div>
      <div className="text-lg font-black text-ink">{value}</div>
    </div>
  );
}
