import { useState, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "motion/react";

export function SearchDashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        handleSearch();
      } else {
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  async function handleSearch() {
    setLoading(true);
    try {
      const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await resp.json();
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text-dim group-focus-within:text-app-accent transition-colors" />
        <Input 
          placeholder="Өнім немесе қоспа атын іздеңіз..." 
          className="pl-10 h-12 bg-app-card border-app-border focus:ring-1 focus:ring-app-accent rounded-xl text-app-text transition-all"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-accent animate-spin" />
        )}
      </div>

      <div className="rounded-2xl border border-app-border bg-app-card overflow-hidden shadow-xl">
        <ScrollArea className="h-[600px]">
          <Table>
            <TableHeader className="bg-app-surface/50 sticky top-0 z-10">
              <TableRow className="border-app-border hover:bg-transparent">
                <TableHead className="w-[100px] text-[10px] font-bold uppercase tracking-widest text-app-text-dim">ID</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-app-text-dim">Type</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-app-text-dim">Title</TableHead>
                <TableHead className="text-[10px] font-bold uppercase tracking-widest text-app-text-dim">Status</TableHead>
                <TableHead className="text-right text-[10px] font-bold uppercase tracking-widest text-app-text-dim">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="popLayout">
                {results.length > 0 ? (
                  results.map((item, idx) => (
                    <motion.tr
                      key={item.id + idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: idx * 0.03, duration: 0.2 }}
                      className="border-app-border hover:bg-app-surface/50 group cursor-default transition-colors"
                    >
                      <TableCell className="font-mono text-[10px] text-app-text-dim">
                        {String(item.id || "").substring(0, 8)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] px-2 py-0 border-transparent ${
                          item.type === 'Қоспа' ? 'bg-app-accent/10 text-app-accent' : 'bg-app-warning/10 text-app-warning'
                        }`}>
                          {item.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-app-text group-hover:text-app-accent transition-colors">{item.title}</div>
                        {item.legal_name && (
                          <div className="text-[10px] text-app-text-dim font-mono truncate max-w-md">{item.legal_name}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className={`px-3 py-1 rounded-full text-[10px] font-bold w-fit ${
                          item.status?.name?.toLowerCase().includes('харам') || item.status?.title?.toLowerCase().includes('харам') 
                            ? 'bg-red-500/10 text-red-500 border border-red-500/20' 
                            : 'bg-app-success/10 text-app-success border border-app-success/20'
                        }`}>
                          {item.status?.name || item.status?.title || "Белгісіз"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px]">
                        {item.confidence === 'exact' ? (
                          <span className="text-app-success font-bold tracking-tighter">EXACT_MATCH</span>
                        ) : (
                          <span className="text-app-text-dim">FUZZY_MATCH</span>
                        )}
                      </TableCell>
                    </motion.tr>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-app-text-dim space-y-2 opacity-50">
                        <Search className="w-8 h-8" />
                        <p className="font-mono text-xs uppercase tracking-widest">
                          {query ? "Ештеңе табылмады" : "Іздеуді бастаңыз"}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}
