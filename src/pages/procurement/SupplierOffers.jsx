import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Truck, Plus, Search, ExternalLink, Calendar, Package } from "lucide-react";
import { Link } from "react-router-dom";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { format } from "date-fns";
import { es } from "date-fns/locale";

const STATUS_LABELS = {
  draft: { label: "Borrador", color: "secondary" },
  imported: { label: "Importada", color: "default" },
  partially_matched: { label: "Asoc. parcial", color: "outline" },
  fully_matched: { label: "Asociada", color: "default" },
  ordered: { label: "Con pedido", color: "default" },
  expired: { label: "Vencida", color: "destructive" },
  archived: { label: "Archivada", color: "secondary" },
};

const EMPTY_FORM = { supplier_name: "", supplier_id: null, offer_name: "", valid_from: "", valid_until: "", notes: "" };

export default function SupplierOffers() {
  const { user, isLoading: loadingUser, isAdmin, getOwnerFilter } = useProcurementUser();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [supplierMode, setSupplierMode] = useState("select"); // "select" | "new"
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  const filter = getOwnerFilter();

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ["supplier-offers", filter],
    queryFn: () => filter
      ? base44.entities.SupplierOffer.filter(filter, "-created_date", 200)
      : base44.entities.SupplierOffer.list("-created_date", 200),
    enabled: !loadingUser,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => base44.entities.Supplier.list("name", 500),
  });

  const filtered = offers.filter((o) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (o.supplier_name || "").toLowerCase().includes(q) || (o.offer_name || "").toLowerCase().includes(q);
    const matchStatus = statusFilter === "all" || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleCreate = async () => {
    if (!form.supplier_name || !form.offer_name) return;
    setSaving(true);
    try {
      await base44.entities.SupplierOffer.create({ ...form, status: "draft" });
      queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setSupplierMode("select");
    } finally {
      setSaving(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  if (loadingUser || isLoading) {
    return <div className="p-6 space-y-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Truck size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ofertas de Proveedores</h1>
            <p className="text-xs text-muted-foreground">
              {filtered.length} oferta(s){isAdmin ? " — vista global" : ""}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={15} className="mr-1.5" /> Nueva Oferta
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input placeholder="Buscar proveedor u oferta..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Truck size={32} className="mx-auto mb-2 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No hay ofertas. Crea una nueva para empezar.</p>
          </Card>
        ) : (
          filtered.map((offer) => {
            const status = STATUS_LABELS[offer.status] || { label: offer.status, color: "secondary" };
            const isExpired = offer.valid_until && offer.valid_until < today;
            return (
              <Card key={offer.id} className={`p-4 hover:shadow-md transition-shadow ${isExpired ? "border-warning/30" : ""}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{offer.offer_name}</span>
                      <Badge variant={status.color} className="text-[10px]">{status.label}</Badge>
                      {isExpired && <Badge variant="outline" className="text-[10px] text-warning border-warning">Vencida</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Truck size={11} /> {offer.supplier_name}</span>
                      <span className="flex items-center gap-1"><Package size={11} /> {offer.valid_rows || 0} ítems</span>
                      <span className="flex items-center gap-1"><Calendar size={11} />
                        {offer.valid_from && format(new Date(offer.valid_from), "dd MMM yyyy", { locale: es })}
                        {offer.valid_until && ` → ${format(new Date(offer.valid_until), "dd MMM yyyy", { locale: es })}`}
                      </span>
                      {isAdmin && <span className="text-[10px] italic">por: {offer.created_by}</span>}
                    </div>
                  </div>
                  <Link to={`/procurement/SupplierOfferDetail/${offer.id}`}>
                    <Button size="sm" variant="outline">
                      <ExternalLink size={13} className="mr-1.5" /> Ver detalle
                    </Button>
                  </Link>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setForm(EMPTY_FORM); setSupplierMode("select"); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nueva Oferta de Proveedor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Supplier selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Proveedor *</label>
              <div className="mt-1 space-y-2">
                {supplierMode === "select" ? (
                  <div className="flex gap-2">
                    <Select
                      value={form.supplier_name}
                      onValueChange={v => {
                        const s = suppliers.find((/** @type {any} */ x) => x.name === v);
                        setForm(p => ({ ...p, supplier_name: v, supplier_id: s?.id ?? null }));
                      }}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Seleccionar proveedor..." />
                      </SelectTrigger>
                      <SelectContent>
                        {suppliers.map(s => (
                          <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => { setSupplierMode("new"); setForm(p => ({ ...p, supplier_name: "" })); }}
                    >
                      + Nuevo
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Nombre del nuevo proveedor"
                      value={form.supplier_name}
                      onChange={e => setForm(p => ({ ...p, supplier_name: e.target.value }))}
                      className="flex-1"
                      autoFocus
                    />
                    {suppliers.length > 0 && (
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => { setSupplierMode("select"); setForm(p => ({ ...p, supplier_name: "" })); }}
                      >
                        Lista
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Nombre / Referencia de la oferta *</label>
              <Input placeholder="Ej: Oferta Marzo 2026" value={form.offer_name} onChange={e => setForm(p => ({ ...p, offer_name: e.target.value }))} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vigencia desde</label>
                <Input type="date" value={form.valid_from} onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Vigencia hasta</label>
                <Input type="date" value={form.valid_until} onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Observaciones</label>
              <Input placeholder="Notas opcionales..." value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleCreate} disabled={saving || !form.supplier_name || !form.offer_name}>
                {saving ? "Guardando..." : "Crear Oferta"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
