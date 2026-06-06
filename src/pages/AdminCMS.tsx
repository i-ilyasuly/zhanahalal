import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Search, Edit, Trash2, Save, X, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";

export default function AdminCMS() {
  const [activeTab, setActiveTab] = useState<"companies" | "ingredients">("ingredients");
  const [view, setView] = useState<"list" | "form">("list");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  
  // Form state
  const [formData, setFormData] = useState<any>(null);

  const fetchCollection = async () => {
    setLoading(true);
    try {
      const coll = activeTab === "companies" ? "search_companies" : "search_ingredients";
      const res = await fetch(`/api/admin/${coll}`);
      if (res.ok) {
         const json = await res.json();
         setData(json);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (view === "list") {
       fetchCollection();
    }
  }, [activeTab, view]);

  // Reset pagination on tab or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery]);

  const handleEdit = (item: any) => {
    setFormData(JSON.parse(JSON.stringify(item))); // deep copy
    setView("form");
  };

  const handleAdd = () => {
    if (activeTab === "companies") {
      setFormData({
        title: "", legal_name: "", certificate_status: "", tin: "",
        address: "", map_link: "", coordinates: { lat: "", lng: "" },
        tags: [], title_aliases: [], is_active: true, status: { title: "", id: "" }
      });
    } else {
      setFormData({
        code: "", name_kz: "", name_ru: "", aliases: [],
        status: "halal", source_type: "", status_reason: "", danger_level: "",
        category: "Қоспа", description_clean: "", is_active: true, is_allergen: false
      });
    }
    setView("form");
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Өшіруге сенімдісіз бе?")) return;
    try {
       const coll = activeTab === "companies" ? "search_companies" : "search_ingredients";
       await fetch(`/api/admin/${coll}/${id}`, { method: "DELETE" });
       fetchCollection();
    } catch (e) {
       console.error("Delete failed", e);
    }
  };

  const saveForm = async () => {
    const coll = activeTab === "companies" ? "search_companies" : "search_ingredients";
    const payload = { ...formData };
    
    // Arrays cleanup
    if (typeof payload.aliases === "string") {
      payload.aliases = payload.aliases.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    if (typeof payload.tags === "string") {
      payload.tags = payload.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    if (typeof payload.title_aliases === "string") {
      payload.title_aliases = payload.title_aliases.split(",").map((s: string) => s.trim()).filter(Boolean);
    }

    // Number conversion
    if (payload.coordinates) {
       payload.coordinates.lat = parseFloat(payload.coordinates.lat) || null;
       payload.coordinates.lng = parseFloat(payload.coordinates.lng) || null;
    }

    try {
       const method = payload.id ? "PUT" : "POST";
       const url = payload.id ? `/api/admin/${coll}/${payload.id}` : `/api/admin/${coll}`;
       
       const res = await fetch(url, {
         method,
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify(payload)
       });
       
       if (res.ok) {
         setView("list");
       } else {
         alert("Сақтау кезінде қате кетті");
       }
    } catch {
       alert("Network error");
    }
  };

  const filteredData = data.filter(d => {
     if (!searchQuery) return true;
     const text = JSON.stringify(d).toLowerCase();
     return text.includes(searchQuery.toLowerCase());
  });

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const paginatedData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex items-center justify-between border-b border-app-border pb-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="p-2 border border-app-border rounded-lg hover:bg-app-card transition">
               <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Басқару Панелі (CMS)</h1>
              <p className="text-xs text-app-text-dim mt-1">Осы жерден базаны қолмен толтырып, түзете аласыз.</p>
            </div>
          </div>
          {view === "list" && (
            <div className="flex bg-app-card rounded-lg p-1 border border-app-border">
               <button 
                 onClick={() => setActiveTab("ingredients")}
                 className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "ingredients" ? "bg-app-accent text-white" : "hover:bg-app-surface"}`}
               >
                 Қоспалар
               </button>
               <button 
                 onClick={() => setActiveTab("companies")}
                 className={`px-4 py-2 rounded-md text-sm font-medium transition ${activeTab === "companies" ? "bg-app-accent text-white" : "hover:bg-app-surface"}`}
               >
                 Мекемелер
               </button>
            </div>
          )}
        </header>

        {/* Content View */}
        {view === "list" ? (
          <div className="space-y-4">
            <div className="flex gap-4">
               <div className="relative flex-grow">
                 <Search className="absolute left-3 top-2.5 w-4 h-4 text-app-text-dim" />
                 <Input 
                   placeholder="Іздеу..." 
                   className="pl-9 bg-app-card border-app-border"
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                 />
               </div>
               <Button onClick={handleAdd} className="bg-app-success hover:bg-app-success/80 text-white gap-2">
                 <Plus className="w-4 h-4" /> Қосу
               </Button>
               <Button onClick={fetchCollection} variant="outline" className="gap-2">
                 <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 
               </Button>
            </div>

            <Card className="bg-app-card border-app-border overflow-hidden">
               <div className="overflow-x-auto w-full">
                 <table className="w-full text-sm text-left whitespace-nowrap">
                   <thead className="bg-app-surface border-b border-app-border">
                     <tr>
                       <th className="p-4 font-medium opacity-70">ID / Код</th>
                       <th className="p-4 font-medium opacity-70">Атауы</th>
                       <th className="p-4 font-medium opacity-70">Статус</th>
                       <th className="p-4 font-medium opacity-70 sticky right-0 bg-app-surface text-right shadow-[-10px_0_15px_-5px_rgba(0,0,0,0.1)]">Әрекеттер</th>
                     </tr>
                   </thead>
                   <tbody>
                     {paginatedData.map(item => (
                       <tr key={item.id} className="border-b border-app-border/50 hover:bg-app-surface/50 transition">
                         <td className="p-4 font-mono text-xs">{item.code || item.id}</td>
                         <td className="p-4 font-bold">{item.name_kz || item.title}</td>
                         <td className="p-4">
                           {item.status === 'halal' || item.status?.id === 'halal' ? <Badge className="bg-green-500/10 text-green-500">Halal / Рұқсат</Badge> : 
                            (item.status === 'haram' || item.status?.id === 'haram' ? <Badge className="bg-red-500/10 text-red-500">Haram</Badge> : 
                            <Badge variant="outline">{typeof item.status === 'object' ? item.status?.title : item.status}</Badge>)}
                         </td>
                         <td className="p-4 text-right flex justify-end gap-2 sticky right-0 bg-app-card/80 backdrop-blur-md shadow-[-10px_0_15px_-5px_rgba(0,0,0,0.1)]">
                            <button onClick={() => handleEdit(item)} className="p-2 text-blue-500 hover:bg-blue-500/10 rounded">
                               <Edit className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleDelete(item.id)} className="p-2 text-red-500 hover:bg-red-500/10 rounded">
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
                 {filteredData.length === 0 && !loading && (
                   <div className="p-8 text-center text-app-text-dim">Ештеңе табылмады.</div>
                 )}
               </div>
               
               {/* Pagination Controls */}
               {totalPages > 1 && (
                 <div className="flex items-center justify-between p-4 border-t border-app-border bg-app-surface/30">
                    <span className="text-xs text-app-text-dim">
                       Барлығы {filteredData.length} жазба (Бет: {currentPage} / {totalPages})
                    </span>
                    <div className="flex gap-2">
                       <Button 
                          variant="outline" 
                          size="sm" 
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                       >Алдыңғы</Button>
                       <Button 
                          variant="outline" 
                          size="sm" 
                          disabled={currentPage === totalPages}
                          onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                       >Келесі</Button>
                    </div>
                 </div>
               )}
            </Card>
          </div>
        ) : (
          /* FORM VIEW */
          <Card className="bg-app-card border-app-border max-w-2xl mx-auto">
             <CardHeader className="border-b border-app-border">
                <CardTitle className="flex items-center gap-2">
                   {formData.id ? <Edit className="w-5 h-5 text-app-accent" /> : <Plus className="w-5 h-5 text-app-success" />} 
                   {formData.id ? "Өзгерту" : "Жаңадан қосу"}
                </CardTitle>
             </CardHeader>
             <CardContent className="p-6 space-y-4">
                {activeTab === "ingredients" ? (
                   <div className="flex flex-col gap-4">
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Коды (мысалы E120)</label>
                       <Input value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Статус</label>
                       <select 
                         className="flex h-10 w-full rounded-md border border-app-border bg-app-card px-3 py-2 text-sm"
                         value={formData.status} 
                         onChange={e => setFormData({...formData, status: e.target.value})}
                        >
                         <option value="halal">Халал (Рұқсат)</option>
                         <option value="haram">Харам (Тыйым)</option>
                         <option value="mushbuh">Күдікті (Mushbuh)</option>
                       </select>
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Атауы (Қазақша)</label>
                        <Input value={formData.name_kz} onChange={e => setFormData({...formData, name_kz: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Атауы (Орысша)</label>
                        <Input value={formData.name_ru} onChange={e => setFormData({...formData, name_ru: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Синонимдері (үтірмен бөліп жазыңыз)</label>
                        <Input 
                           value={Array.isArray(formData.aliases) ? formData.aliases.join(", ") : formData.aliases} 
                           onChange={e => setFormData({...formData, aliases: e.target.value})} 
                           placeholder="Кармин, Кармин қышқылы"
                        />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Шығу тегі</label>
                       <Input value={formData.source_type} onChange={e => setFormData({...formData, source_type: e.target.value})} placeholder="Малдан, Өсімдік, Синтетика..."/>
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Қауіптілік деңгейі</label>
                       <Input value={formData.danger_level} onChange={e => setFormData({...formData, danger_level: e.target.value})} placeholder="Төмен, Орташа, Жоғары..." />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Ескерту (неге күдікті т.б.)</label>
                        <textarea 
                           className="flex w-full rounded-md border border-app-border bg-app-card px-3 py-2 text-sm min-h-[80px]"
                           value={formData.status_reason} 
                           onChange={e => setFormData({...formData, status_reason: e.target.value})} 
                        />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Толық түсініктеме</label>
                        <textarea 
                           className="flex w-full rounded-md border border-app-border bg-app-card px-3 py-2 text-sm min-h-[120px]"
                           value={formData.description_clean} 
                           onChange={e => setFormData({...formData, description_clean: e.target.value})} 
                        />
                     </div>
                     <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="isActive" checked={formData.is_active} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
                        <label htmlFor="isActive" className="text-sm">Активті ме?</label>
                     </div>
                   </div>
                ) : (
                   <div className="flex flex-col gap-4">
                     {/* COMPANY FORM */}
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Бренд атауы</label>
                       <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Заңды атауы</label>
                       <Input value={formData.legal_name} onChange={e => setFormData({...formData, legal_name: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Таңба</label>
                       <Input value={formData.brand || ""} onChange={e => setFormData({...formData, brand: e.target.value})} placeholder="Бренд..."/>
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Түйін/БСН (TIN)</label>
                       <Input value={formData.tin || ""} onChange={e => setFormData({...formData, tin: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Телефон</label>
                       <Input value={formData.phone || ""} onChange={e => setFormData({...formData, phone: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Категория</label>
                       <Input value={formData.category || ""} onChange={e => setFormData({...formData, category: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Ұйым статусы (ID)</label>
                       <Input value={formData.status?.id || formData.status || ""} onChange={e => setFormData({...formData, status: { ...formData.status, id: e.target.value }})} placeholder="halal, expired..." />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Ұйым статусы (Атауы)</label>
                       <Input value={formData.status?.title || ""} onChange={e => setFormData({...formData, status: { ...formData.status, title: e.target.value }})} placeholder="Халал, Жойылған..." />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Сертификат мәртебесі</label>
                       <Input value={formData.certificate_status || ""} onChange={e => setFormData({...formData, certificate_status: e.target.value})} placeholder="Active, Expired..."/>
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Сертификат басы (Issued at)</label>
                        <Input type="date" value={formData.certificate?.issued_at ? new Date(formData.certificate.issued_at).toISOString().split('T')[0] : ""} onChange={e => setFormData({...formData, certificate: {...formData.certificate, issued_at: new Date(e.target.value).toISOString()}})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Сертификат соңы (Expires at)</label>
                        <Input type="date" value={formData.certificate?.expires_at ? new Date(formData.certificate.expires_at).toISOString().split('T')[0] : ""} onChange={e => setFormData({...formData, certificate: {...formData.certificate, expires_at: new Date(e.target.value).toISOString()}})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Сертификат нөмірі</label>
                        <Input value={formData.certificate?.number || ""} onChange={e => setFormData({...formData, certificate: {...formData.certificate, number: e.target.value}})} placeholder="М-..." />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Қысқаша сипаттама (Short description)</label>
                        <textarea 
                           className="flex w-full rounded-md border border-app-border bg-app-card px-3 py-2 text-sm min-h-[80px]"
                           value={formData.short_description || ""} 
                           onChange={e => setFormData({...formData, short_description: e.target.value})} 
                        />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Толық түсініктеме</label>
                        <textarea 
                           className="flex w-full rounded-md border border-app-border bg-app-card px-3 py-2 text-sm min-h-[120px]"
                           value={formData.description_clean || ""} 
                           onChange={e => setFormData({...formData, description_clean: e.target.value})} 
                        />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Қала (City)</label>
                        <Input value={formData.city || ""} onChange={e => setFormData({...formData, city: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Мекен-жайы</label>
                        <Input value={formData.address || ""} onChange={e => setFormData({...formData, address: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Карта сілтемесі</label>
                        <Input value={formData.map_link || ""} onChange={e => setFormData({...formData, map_link: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Фото сурет сілтемесі (Logo URL)</label>
                        <Input value={formData.logo_image || ""} onChange={e => setFormData({...formData, logo_image: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Email</label>
                       <Input value={formData.email || ""} onChange={e => setFormData({...formData, email: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                       <label className="text-xs text-app-text-dim">Web сайт</label>
                       <Input value={formData.website || ""} onChange={e => setFormData({...formData, website: e.target.value})} />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Синонимдері (үтірмен бөліп жазыңыз)</label>
                        <Input 
                           value={Array.isArray(formData.title_aliases) ? formData.title_aliases.join(", ") : formData.title_aliases} 
                           onChange={e => setFormData({...formData, title_aliases: typeof e.target.value === 'string' ? e.target.value.split(',').map(s=>s.trim()).filter(Boolean) : e.target.value})} 
                        />
                     </div>
                     <div className="space-y-1">
                        <label className="text-xs text-app-text-dim">Тегтер (үтірмен бөліп жазыңыз)</label>
                        <Input 
                           value={Array.isArray(formData.tags) ? formData.tags.join(", ") : formData.tags} 
                           onChange={e => setFormData({...formData, tags: typeof e.target.value === 'string' ? e.target.value.split(',').map(s=>s.trim()).filter(Boolean) : e.target.value})} 
                           placeholder="Шұжық, Тамақтану..."
                        />
                     </div>
                     <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="isActiveComp" checked={formData.is_active !== false} onChange={e => setFormData({...formData, is_active: e.target.checked})} />
                        <label htmlFor="isActiveComp" className="text-sm">Активті ме?</label>
                     </div>
                     <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="isDeliveryOnly" checked={formData.is_delivery_only} onChange={e => setFormData({...formData, is_delivery_only: e.target.checked})} />
                        <label htmlFor="isDeliveryOnly" className="text-sm">Тек жеткізу (Delivery only)?</label>
                     </div>
                     <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="hasPrayerRoom" checked={formData.has_prayer_room} onChange={e => setFormData({...formData, has_prayer_room: e.target.checked})} />
                        <label htmlFor="hasPrayerRoom" className="text-sm">Намазхана бар ма?</label>
                     </div>
                     <div className="flex items-center gap-2 mt-4">
                        <input type="checkbox" id="hasAlcohol" checked={formData.has_halal_alcohol} onChange={e => setFormData({...formData, has_halal_alcohol: e.target.checked})} />
                        <label htmlFor="hasAlcohol" className="text-sm">Халал ішімдік бар ма?</label>
                     </div>
                   </div>
                )}

                <div className="flex justify-end gap-4 pt-6 border-t border-app-border mt-8">
                   <Button variant="outline" onClick={() => setView("list")} className="gap-2 text-app-text-dim hover:text-white">
                      <X className="w-4 h-4" /> Болдырмау
                   </Button>
                   <Button onClick={saveForm} className="bg-app-accent hover:bg-app-accent/80 text-white gap-2">
                      <Save className="w-4 h-4" /> Сақтау
                   </Button>
                </div>
             </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
