import { ShieldCheck, MessageSquare, ExternalLink } from "lucide-react";

export default function App() {
  return (
    <div className="min-h-screen bg-[#07090e] text-[#f8fafc] font-sans antialiased flex flex-col justify-between p-6 md:p-12 selection:bg-[#0ea5e9]/30">
      {/* Background Decorative Gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#072d4c]/20 via-[#07090e] to-[#07090e] pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#0ea5e9]/10 rounded-xl border border-[#0ea5e9]/20">
            <ShieldCheck className="w-6 h-6 text-[#0ea5e9]" />
          </div>
          <div>
            <span className="text-[10px] font-mono tracking-widest text-[#0ea5e9] uppercase font-bold">Official Bot</span>
            <h1 className="text-sm font-semibold text-[#94a3b8]">Halal Damu</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
          <span className="text-xs font-mono text-[#10b981]">Белсенді — Live</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 max-w-xl mx-auto text-center my-auto flex flex-col items-center gap-6">
        <div className="relative">
          <div className="absolute -inset-1 rounded-full bg-gradient-to-r from-[#0ea5e9] to-[#2563eb] opacity-40 blur-lg animate-pulse" />
          <div className="relative bg-[#0b1329] p-5 rounded-full border border-[#1e293b]">
            <MessageSquare className="w-12 h-12 text-[#38bdf8]" />
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-[#f1f5f9] to-[#94a3b8] bg-clip-text text-transparent">
            Халал Даму Бот
          </h2>
          <p className="text-sm text-[#94a3b8] leading-relaxed max-w-md mx-auto">
            Халал өнімдерді, тамақтану орындарын және Е-қоспаларды тексеруге арналған ресми Telegram көмекшісі. Батырмалар статустарға сәйкес толықтай жаңартылды.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
          <a
            href="https://t.me/HalalDamuTestBot"
            target="_blank"
            rel="noopener noreferrer"
            id="launch-bot-btn"
            className="flex items-center gap-2 bg-[#0ea5e9] hover:bg-[#0284c7] text-white text-xs font-black uppercase tracking-wider px-8 py-3.5 rounded-xl transition-all duration-300 shadow-[0_8px_30px_rgb(14,165,233,0.3)] hover:shadow-[0_8px_35px_rgb(14,165,233,0.5)] hover:-translate-y-0.5"
          >
            Ботты іске қосу <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center border-t border-[#1e293b]/50 pt-6 text-[10px] font-mono text-[#64748b]">
        <div className="flex flex-col md:flex-row justify-between items-center gap-3">
          <div>© {new Date().getFullYear()} Halal Damu. Барлық құқықтар қорғалған.</div>
          <div className="bg-[#1e293b]/40 px-3 py-1.5 rounded-full border border-[#1e293b] text-[#94a3b8]">
            v2.2.0 (Premium)
          </div>
        </div>
      </footer>
    </div>
  );
}
