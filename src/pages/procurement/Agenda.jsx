import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarDays, Building2, PhoneCall, CreditCard, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";

const PAYMENT_DONE_STATUSES = ["pagado", "recibido", "parcialmente_recibido", "cancelado"];

const EVENT_CONFIG = {
  contacto_programado: { label: "Próximo contacto",   dot: "#3b82f6", textCls: "text-blue-400"   },
  contacto_realizado:  { label: "Contacto realizado", dot: "#22c55e", textCls: "text-emerald-400" },
  pago:                { label: "Pagar pedido",       dot: "#8b5cf6", textCls: "text-violet-400"  },
};

const WEEK_LABELS = ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function buildCalendarGrid(month) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end   = endOfWeek(endOfMonth(month),     { weekStartsOn: 1 });
  const days  = [];
  let cur = start;
  while (cur <= end) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  // Pad to exactly 6 weeks (42 cells) so height is stable across months
  while (days.length < 42) days.push(addDays(days[days.length - 1], 1));
  return days;
}

export default function Agenda() {
  const { getOwnerFilter, isLoading: loadingUser } = useProcurementUser();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-agenda"],
    queryFn:  () => base44.entities.Supplier.list("name", 1000),
    staleTime: 5 * 60 * 1000,
  });

  const { data: supplierContacts = [] } = useQuery({
    queryKey: ["supplier-contacts"],
    queryFn:  () => base44.entities.SupplierContact.list("-contact_date", 2000),
    staleTime: 2 * 60 * 1000,
  });

  const ownerFilter = getOwnerFilter();
  const { data: orders = [] } = useQuery({
    queryKey: ["purchase-orders-agenda", ownerFilter],
    queryFn: () => ownerFilter
      ? base44.entities.PurchaseOrder.filter(ownerFilter, "-created_date", 500)
      : base44.entities.PurchaseOrder.list("-created_date", 500),
    enabled: !loadingUser,
  });

  // Map<"yyyy-MM-dd", evento[]>
  const eventsByDate = useMemo(() => {
    const map = new Map();
    const push = (dateKey, event) => {
      if (!dateKey) return;
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey).push(event);
    };

    suppliers.forEach(s => {
      if (s.is_active === false || !s.next_contact_date) return;
      push(s.next_contact_date.slice(0, 10), {
        type: "contacto_programado",
        label: s.name,
        link: "/procurement/Suppliers",
      });
    });

    supplierContacts.forEach(c => {
      if (!c.contact_date) return;
      push(c.contact_date.slice(0, 10), {
        type: "contacto_realizado",
        label: c.supplier_name || "Proveedor",
        link: "/procurement/Suppliers",
      });
    });

    orders.forEach(o => {
      if (o.fecha_limite_pago && !PAYMENT_DONE_STATUSES.includes(o.status)) {
        push(o.fecha_limite_pago.slice(0, 10), {
          type: "pago",
          label: `#${o.id.slice(-6).toUpperCase()} · ${o.supplier_name}`,
          link: `/procurement/PurchaseOrderDetail/${o.id}`,
        });
      }
    });

    return map;
  }, [suppliers, supplierContacts, orders]);

  const calendarDays = useMemo(() => buildCalendarGrid(currentMonth), [currentMonth]);

  const selectedKey   = format(selectedDate, "yyyy-MM-dd");
  const selectedTasks = eventsByDate.get(selectedKey) || [];
  const isToday       = selectedKey === todayStr();
  const today         = todayStr();

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <CalendarDays size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Agenda de Reabastecimiento</h1>
          <p className="text-xs text-muted-foreground">Contactos con proveedores y pagos de pedidos por fecha</p>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-0">

          {/* ── Calendario ── */}
          <div className="min-w-0">
            {/* Nav de mes */}
            <div className="flex items-center justify-between mb-4 pr-0 lg:pr-5">
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                <ChevronLeft size={15} />
              </Button>
              <h2 className="text-sm font-bold capitalize tracking-wide">
                {format(currentMonth, "MMMM yyyy", { locale: es })}
              </h2>
              <Button variant="outline" size="icon" className="h-8 w-8"
                onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                <ChevronRight size={15} />
              </Button>
            </div>

            {/* Cabecera días */}
            <div className="grid grid-cols-7 mb-1 pr-0 lg:pr-5">
              {WEEK_LABELS.map(d => (
                <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1 uppercase tracking-wide">
                  {d}
                </div>
              ))}
            </div>

            {/* Grid de días */}
            <div className="grid grid-cols-7 gap-1 pr-0 lg:pr-5">
              {calendarDays.map((day, i) => {
                const dateKey     = format(day, "yyyy-MM-dd");
                const events      = eventsByDate.get(dateKey) || [];
                const isSelected  = dateKey === selectedKey;
                const isTodayCell = dateKey === today;
                const inMonth     = isSameMonth(day, currentMonth);

                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(day)}
                    className={`
                      rounded-lg p-1.5 text-left min-h-[72px] flex flex-col transition-all text-xs
                      ${!inMonth ? "opacity-25" : ""}
                      ${isSelected
                          ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background"
                          : isTodayCell
                            ? "bg-primary/10 ring-1 ring-primary/40"
                            : "hover:bg-muted/60 border border-transparent hover:border-border/50"}
                    `}
                  >
                    <span className={`text-[12px] font-bold mb-1 self-end pr-0.5 ${isTodayCell && !isSelected ? "text-primary" : isSelected ? "text-primary-foreground" : ""}`}>
                      {format(day, "d")}
                    </span>

                    {/* Eventos: hasta 2 líneas con dot + label truncado */}
                    <div className="flex flex-col gap-0.5 w-full mt-auto">
                      {events.slice(0, 2).map((e, j) => {
                        const cfg = EVENT_CONFIG[e.type];
                        return (
                          <div key={j} className="flex items-center gap-1 min-w-0">
                            <span className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                              style={{ background: isSelected ? "currentColor" : cfg.dot }} />
                            <span className={`truncate text-[10px] leading-tight ${isSelected ? "opacity-90" : "text-muted-foreground"}`}>
                              {e.label}
                            </span>
                          </div>
                        );
                      })}
                      {events.length > 2 && (
                        <span className={`text-[10px] ${isSelected ? "opacity-70" : "text-muted-foreground"}`}>
                          +{events.length - 2} más
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Leyenda */}
            <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-border/50 pr-0 lg:pr-5">
              {Object.entries(EVENT_CONFIG).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />
                  {cfg.label}
                </div>
              ))}
            </div>
          </div>

          {/* ── Panel derecho: tareas del día seleccionado ── */}
          <div className="lg:border-l lg:pl-5 mt-5 lg:mt-0 pt-5 lg:pt-0 border-t lg:border-t-0 border-border/50">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide mb-3">
              {isToday
                ? "Hoy"
                : format(selectedDate, "EEEE d 'de' MMMM", { locale: es })}
            </p>

            {selectedTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground gap-2">
                <CalendarDays size={28} className="opacity-20" />
                <p className="text-xs">Sin tareas para este día</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {selectedTasks.map((t, i) => {
                  const cfg  = EVENT_CONFIG[t.type];
                  const Icon = t.type === "contacto_programado" ? Building2
                             : t.type === "contacto_realizado"  ? PhoneCall
                             : CreditCard;
                  return (
                    <Link
                      key={i}
                      to={t.link}
                      className="flex items-start gap-2.5 text-xs rounded-lg border border-border/60 px-3 py-2.5 hover:bg-muted/40 transition-colors group"
                    >
                      <div className="mt-0.5 h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0"
                        style={{ background: `${cfg.dot}20` }}>
                        <Icon size={12} style={{ color: cfg.dot }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate group-hover:text-primary transition-colors">{cfg.label}</p>
                        <p className="text-muted-foreground truncate text-[11px] mt-0.5">{t.label}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* Mini-resumen del mes */}
            {(() => {
              const monthKey = format(currentMonth, "yyyy-MM");
              let total = 0;
              eventsByDate.forEach((evs, key) => {
                if (key.startsWith(monthKey)) total += evs.length;
              });
              return total > 0 ? (
                <p className="text-[10px] text-muted-foreground mt-4 pt-3 border-t border-border/50">
                  {total} tarea(s) en {format(currentMonth, "MMMM", { locale: es })}
                </p>
              ) : null;
            })()}
          </div>

        </div>
      </Card>
    </div>
  );
}
