import { Badge } from "@/components/ui/badge";
import Image from "next/image";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#0a0a0a] selection:bg-white/20">
      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center overflow-hidden px-4 pb-24 pt-40 text-center">
        <Badge variant="outline" className="gap-2 p-4 backdrop-blur-sm">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Powered by Agentic AI
        </Badge>
      </section>
    </main>
  );
}
