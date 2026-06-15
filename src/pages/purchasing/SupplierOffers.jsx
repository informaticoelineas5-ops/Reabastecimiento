import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Upload, Plus, Eye, ShoppingCart, Clock, CheckCircle, AlertCircle, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_CONFIG = {
  borrador: { label: "Borrador", color: "bg-gray-100 text-gray-700" },
  importada: { label: "Importada", color: "bg-blue-100 text-blue-700" },
  procesada: { label: "Procesada", color: "bg-indigo-100 text-indigo-700" },
  asociada_parcial: { label: "Asoc. Parcial", color: "bg-yellow-100 text-yellow-700" },
  asociada_completa: { label: "Asoc. Completa", color: "bg-green-100 text-green-700" },
  usada_en_pedido: { label: "En Pedido", color: "bg-purple-100 text-purple-700" },
  vencida: { label: "Vencida", color: "bg-red-100 text-red-700" },
  archivada: { label: "Archivada", color: "bg-gray-200 text-gray-500" },
};

export default function SupplierOffers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef();

  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ offer_name: "", supplier_name: "", valid_from: "", valid_until: "", default_currency: "USD", exchange_rate: 1, notes: "" });
  const [parsedRows, setParsedRows] = useState([]);
  const [fileError, setFileError] = useState("");
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState(null);

  React.useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const isAdmin = user && !["comercial"].includes(user.role);

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["supplier-offers", user?.email],
    queryFn: () => isAdmin
      ? base44.entities.SupplierOffer.list("-created_date", 200)
      : base44.entities.SupplierOffer.filter({ imported_by: user.email }, "-created_date", 200),
    enabled: !!user,
  });

  const handleFile = (e) => {
    setFileError("");
    setParsedRows([]);
    const file = e.target.files[0];
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      setFileError("Formato no soportado. Use Excel (.xlsx, .xls) o CSV.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      setParsedRows(rows);
    };
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    if (!form.offer_name || !form.supplier_name) { toast({ title: "Complete nombre y proveedor", variant: "destructive" }); return; }
    if (parsedRows.length === 0) { toast({ title: "Cargue un archivo con filas", variant: "destructive" }); return; }
    setSaving(true);
    const offer = await base44.entities.SupplierOffer.create({
      ...form,
      exchange_rate: parseFloat(form.exchange_rate) || 1,
      imported_by: user.email,
      status: "importada",
      total_rows: parsedRows.length,
      valid_rows: parsedRows.length,
      invalid_rows: 0,
    });

    const items = parsedRows.map((r, i) => ({
      offer_id: offer.id,
      imported_by: user.email,
      supplier_product_code: String(r["Código"] || r["codigo"] || r["SKU"] || r["code"] || ""),
      supplier_product_name: String(r["Nombre"] || r["nombre"] || r["name"] || r["Producto"] || r["producto"] || "Sin nombre"),
      supplier_description: String(r["Descripción"] || r["descripcion"] || r["description"] || ""),
      format: String(r["Formato"] || r["formato"] || r["format"] || ""),
      unit: String(r["Unidad"] || r["unidad"] || r["unit"] || ""),
      offered_cost: parseFloat(r["Precio"] || r["precio"] || r["Costo"] || r["costo"] || r["cost"] || 0) || 0,
      currency: String(r["Moneda"] || r["moneda"] || r["currency"] || form.default_currency),
      min_qty: parseFloat(r["Mín"] || r["min_qty"] || r["CantMin"] || 1) || 1,
      pack_multiple: parseFloat(r["Múltiplo"] || r["multiplo"] || r["pack_multiple"] || 1) || 1,
      availability: String(r["Disponibilidad"] || r["disponibilidad"] || r["availability"] || ""),
      lead_time_days: parseInt(r["Días"] || r["lead_time"] || r["dias_entrega"] || 0) || 0,
      notes: String(r["Notas"] || r["notas"] || r["notes"] || ""),
      row_index: i,
    }));

    await base44.entities.SupplierOfferItem.bulkCreate(items);
    queryClient.invalidateQueries(["supplier-offers"]);
    setSaving(false);
    setShowImport(false);
    setParsedRows([]);
    setForm({ offer_name: "", supplier_name: "", valid_from: "", valid_until: "", default_currency: "USD", exchange_rate: 1, base_currency: "USD", notes: "" });
    toast({ title: `Oferta importada: ${parsedRows.length} líneas` });
    navigate(`/OfferDetail?id=${offer.id}`);
  };

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Ofertas de Proveedores</h1>
          <p className="text-xs text-muted-foreground">{isAdmin ? "Vista global" : "Mis ofertas importadas"}</p>
        </div>
        <Button onClick={() => setShowImport(true)}>
          <Plus size={15} className="mr-1.5" /> Nueva Oferta
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />)}
        </div>
      ) : offers.length === 0 ? (
        <Card className="p-12 text-center">
          <FileSpreadsheet size={32} className="mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay ofertas importadas. Importe la primera oferta de proveedor.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {offers.map(o => {
            const st = STATUS_CONFIG[o.status] || STATUS_CONFIG.importada;
            const isVencida = o.valid_until && new Date(o.valid_until) < new Date();
            return (
              <Card key={o.id} className="p-4 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold truncate">{o.offer_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>{st.label}</span>
                      {isVencida && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Vencida</span>}
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>🏭 {o.supplier_name}</span>
                      <span>📦 {o.valid_rows || o.total_rows || 0} líneas</span>
                      {o.valid_until && <span>📅 Vence: {o.valid_until}</span>}
                      {isAdmin && <span>👤 {o.imported_by}</span>}
                      <span>{o.default_currency} (×{o.exchange_rate || 1})</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/OfferDetail?id=${o.id}`)}>
                      <Eye size={13} className="mr-1" /> Ver
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/ProductMatching?offer_id=${o.id}`)}>
                      Asociar
                    </Button>
                    <Button size="sm" onClick={() => navigate(`/ReplenishmentProposal?offer_id=${o.id}`)}>
                      <ShoppingCart size={13} className="mr-1" /> Propuesta
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar Oferta de Proveedor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre de oferta *</Label>
                <Input value={form.offer_name} onChange={e => setForm({...form, offer_name: e.target.value})} placeholder="Ej: Oferta Abril 2026" />
              </div>
              <div className="space-y-1">
                <Label>Proveedor *</Label>
                <Input value={form.supplier_name} onChange={e => setForm({...form, supplier_name: e.target.value})} placeholder="Nombre del proveedor" />
              </div>
              <div className="space-y-1">
                <Label>Vigencia desde</Label>
                <Input type="date" value={form.valid_from} onChange={e => setForm({...form, valid_from: e.target.value})} />
              </div>
              <div className="space-y-1">
                <Label>Vigencia hasta</Label>
                <Input type="date" value={form.valid_until} onChange={e => setForm({...form, valid_until: e.target.value})} />
              </div>
              <div className="space-y-1">
                <Label>Moneda</Label>
                <Input value={form.default_currency} onChange={e => setForm({...form, default_currency: e.target.value})} placeholder="USD, EUR, CUP..." />
              </div>
              <div className="space-y-1">
                <Label>Tasa de cambio</Label>
                <Input type="number" value={form.exchange_rate} onChange={e => setForm({...form, exchange_rate: e.target.value})} placeholder="1" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} />
            </div>

            <div className="space-y-2">
              <Label>Archivo (Excel / CSV) *</Label>
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Haz clic para seleccionar archivo</p>
                <p className="text-xs text-muted-foreground mt-1">.xlsx, .xls, .csv</p>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
              </div>
              {fileError && <p className="text-xs text-destructive">{fileError}</p>}
              {parsedRows.length > 0 && (
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-sm text-green-700 dark:text-green-400">
                  ✅ {parsedRows.length} filas detectadas — Columnas: {Object.keys(parsedRows[0]).slice(0,5).join(", ")}...
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowImport(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={handleImport} disabled={saving}>
                {saving ? "Importando..." : "Importar Oferta"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}