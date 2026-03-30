import React, { useState } from "react";
import { Settings, Folder, Database, Key, Globe, Layout, Save, Download, Upload, Merge, Activity, Zap, Info } from "lucide-react";
import { cn } from "@/src/lib/utils";

export default function SettingsPanel() {
  const [apiKey, setApiKey] = useState("sk-********************");
  const [apiUrl, setApiUrl] = useState("https://api.openai.com/v1");
  const [showThinking, setShowThinking] = useState(true);
  const [ollamaStatus, setOllamaStatus] = useState<"green" | "yellow" | "red">("green");

  return (
    <div className="h-full bg-paper text-ink overflow-y-auto scrollbar-none pt-24 pb-12 px-6">
      <div className="max-w-2xl mx-auto space-y-20">
        {/* Header */}
        <header className="space-y-4">
          <h2 className="text-3xl font-black tracking-tighter text-ink">Settings</h2>
          <p className="text-sm text-ink/40 leading-relaxed max-w-md">
            Configure your Aris v2 experience. These settings are stored locally in your browser.
          </p>
        </header>

        {/* API Configuration */}
        <section className="space-y-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-px bg-ink/10" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-ink/20">API Configuration</h3>
          </div>
          
          <div className="space-y-8">
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Gemini API Key</label>
              <input 
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your key..."
                className="w-full bg-transparent border-b border-border-ink/50 py-3 text-sm focus:border-ink transition-all outline-none placeholder:text-ink/10"
              />
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Model Selection</label>
              <select 
                value="gemini-3-flash-preview"
                className="w-full bg-transparent border-b border-border-ink/50 py-3 text-sm focus:border-ink transition-all outline-none appearance-none cursor-pointer"
              >
                <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Smart)</option>
              </select>
            </div>
          </div>
        </section>

        {/* UI Options */}
        <section className="space-y-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-px bg-ink/10" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-ink/20">Interface</h3>
          </div>

          <div className="space-y-8">
            <div className="flex items-center justify-between group">
              <div className="space-y-1">
                <span className="text-sm font-bold text-ink group-hover:text-ink/80 transition-colors">Ink Wash Theme</span>
                <p className="text-[10px] text-ink/30">Minimalist aesthetic with subtle textures.</p>
              </div>
              <div className="w-10 h-5 bg-ink rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-3 h-3 bg-paper rounded-full" />
              </div>
            </div>

            <div className="flex items-center justify-between group">
              <div className="space-y-1">
                <span className="text-sm font-bold text-ink group-hover:text-ink/80 transition-colors">Thinking Process</span>
                <p className="text-[10px] text-ink/30">Show AI's internal reasoning steps.</p>
              </div>
              <div className="w-10 h-5 bg-ink/10 rounded-full relative cursor-pointer">
                <div className="absolute left-1 top-1 w-3 h-3 bg-paper rounded-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Storage */}
        <section className="space-y-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-px bg-ink/10" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-ink/20">Storage</h3>
          </div>

          <div className="flex items-center gap-6">
            <button className="text-[10px] font-black uppercase tracking-widest text-ink/40 hover:text-ink transition-colors border-b border-transparent hover:border-ink pb-1">
              Export Data
            </button>
            <button className="text-[10px] font-black uppercase tracking-widest text-ink/40 hover:text-ink transition-colors border-b border-transparent hover:border-ink pb-1">
              Import Data
            </button>
            <button className="text-[10px] font-black uppercase tracking-widest text-red-400/60 hover:text-red-500 transition-colors border-b border-transparent hover:border-red-500 pb-1">
              Clear All
            </button>
          </div>
        </section>

        <footer className="pt-20 pb-10 text-center">
          <span className="text-[9px] font-black uppercase tracking-[0.4em] text-ink/5">
            Aris v2 • Version 2.0.4-Ink
          </span>
        </footer>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, primary = false }: { icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button className={cn(
      "flex items-center justify-center gap-2 px-6 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all border",
      primary 
        ? "bg-ink text-paper border-ink hover:bg-ink/90" 
        : "bg-transparent hover:bg-mist text-ink/40 border-border-ink/20"
    )}>
      {icon}
      {label}
    </button>
  );
}
