import React, { useState } from "react";
import { User, Activity, Brain, Clock, Save, ChevronRight, Heart, Zap, AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";

export default function UserArisPanel() {
  const [userName, setUserName] = useState("Kaka");
  const [userNotes, setUserNotes] = useState("喜欢简洁的技术文档，偏好深色模式。");

  return (
    <div className="h-full bg-paper text-ink overflow-y-auto scrollbar-none pt-24 pb-12 px-6">
      <div className="max-w-2xl mx-auto space-y-20">
        {/* User Profile */}
        <section className="space-y-12">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">User Profile</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">Personal Identity & Preferences</p>
          </div>

          <div className="space-y-8">
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-ink/10">Identity</label>
              <input 
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full bg-transparent border-b border-border-ink/50 py-3 text-sm focus:border-ink transition-all outline-none placeholder:text-ink/10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black uppercase tracking-widest text-ink/10">Notes</label>
              <textarea 
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                className="w-full bg-transparent border-b border-border-ink/50 py-3 text-sm focus:border-ink transition-all outline-none min-h-[80px] resize-none placeholder:text-ink/10"
              />
            </div>
            <button className="text-[10px] font-black uppercase tracking-widest text-ink/40 hover:text-ink transition-colors flex items-center gap-2">
              <Save size={14} />
              Update Profile
            </button>
          </div>
        </section>

        {/* Aris Status */}
        <section className="space-y-12">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">Aris Status</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">System State & Psychology</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-border-ink/5 pb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-ink/20">Last Active</span>
                <span className="text-sm font-mono text-ink/60">09:00:00</span>
              </div>
              <div className="flex items-center justify-between border-b border-border-ink/5 pb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-ink/20">Mood State</span>
                <span className="text-[10px] font-mono text-ink/40 italic">Calm / Curious</span>
              </div>
              <div className="flex items-center justify-between border-b border-border-ink/5 pb-4">
                <span className="text-[10px] font-black uppercase tracking-widest text-ink/20">Energy</span>
                <div className="w-24 h-1 bg-ink/5 rounded-full overflow-hidden">
                  <div className="h-full w-3/4 bg-ink/40" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-[9px] font-black uppercase tracking-widest text-ink/10">Active Flags</h3>
              <div className="space-y-3">
                <StatusItem label="Low Power" value="Active" active />
                <StatusItem label="Response Count" value="0" />
                <StatusItem label="Off Duty" value="False" />
              </div>
            </div>
          </div>
        </section>

        {/* Recent Logs */}
        <section className="space-y-12">
          <div className="space-y-1">
            <h2 className="text-2xl font-black tracking-tighter text-ink">Recent Logs</h2>
            <p className="text-[10px] text-ink/20 uppercase font-bold tracking-[0.2em]">Activity & Correction History</p>
          </div>

          <div className="space-y-8">
            <RecordList title="Emotional" items={[
              { time: "09:00:00", text: "Detected user emotion: Calm" },
              { time: "08:45:12", text: "Detected user emotion: Curious" },
            ]} />
            <RecordList title="Desire" items={[
              { time: "09:02:00", text: "Desire Level: 3 (Low)" },
              { time: "08:30:00", text: "Desire Level: 7 (High)" },
            ]} />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusItem({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-ink/40 font-bold uppercase tracking-widest text-[9px]">{label}</span>
      <span className={cn("font-mono", active ? "text-ink" : "text-ink/10")}>{value}</span>
    </div>
  );
}

function RecordList({ title, items }: { title: string; items: { time: string; text: string }[] }) {
  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/10 border-l-2 border-ink/5 pl-3">
        {title}
      </h3>
      <div className="space-y-4 pl-4">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-4">
            <span className="text-[9px] font-mono text-ink/10 mt-0.5">{item.time}</span>
            <span className="text-xs text-ink/60 leading-relaxed">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
