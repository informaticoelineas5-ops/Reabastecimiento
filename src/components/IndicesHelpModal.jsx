import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Star, Calendar, Zap } from "lucide-react";

const INDICES = [
  {
    short: "P.>0",
    label: "Prom. Diario > 0",
    desc: "Promedio de unidades vendidas por día, contando únicamente los días en que hubo al menos una venta. Los días sin movimiento no se incluyen en el cálculo.",
    when: "Es el índice principal para reabastecimiento. Refleja el ritmo real de salida cuando el producto está disponible en tienda.",
    tag: "principal",
  },
  {
    short: "P.≥½",
    label: "Prom. Diario ≥ max/2",
    desc: "Promedio de los días con venta alta: solo cuenta los días en que se vendió al menos la mitad del máximo diario histórico del producto. Elimina tanto los días sin venta como los días con ventas atípicamente bajas.",
    when: "Útil para productos con demanda irregular o discontinua. Más conservador que P.>0.",
    tag: "conservador",
  },
  {
    short: "P.Tod",
    label: "Prom. Diario Todos",
    desc: "Promedio de ventas diarias incluyendo todos los días del período, incluso aquellos en que el producto no se vendió nada (días en cero).",
    when: "Sirve para calcular el promedio real del calendario. Siempre será menor que P.>0. Útil para planificación de largo plazo.",
    tag: "conservador",
  },
  {
    short: "P.NoF",
    label: "Prom. Diario No Festivas",
    desc: "Promedio de ventas solo en días laborables normales, excluyendo festivos y fines de semana.",
    when: "Para productos cuya demanda cae en días no laborables (ej: artículos de oficina, alimentación corporativa).",
    tag: "especial",
  },
  {
    short: "P.Fest",
    label: "Prom. Diario Festivas",
    desc: "Promedio de ventas solo en días festivos y fines de semana.",
    when: "Para productos que se venden más cuando hay más flujo de público (ej: bebidas, snacks, juguetes).",
    tag: "especial",
  },
  {
    short: "P.NDic",
    label: "Prom. Diario Nov + Dic",
    desc: "Promedio de ventas durante noviembre y diciembre, que es la temporada comercial más alta del año.",
    when: "Usar para planificar el stock de temporada navideña con anticipación.",
    tag: "temporada",
  },
  {
    short: "P.Feb",
    label: "Prom. Diario 14 Feb",
    desc: "Promedio de ventas durante la primera quincena de febrero, en torno al Día de San Valentín.",
    when: "Para reabastecer productos de regalo, flores artificiales, chocolates, etc., antes del 14 de febrero.",
    tag: "temporada",
  },
  {
    short: "P.Mad",
    label: "Prom. Diario Madres",
    desc: "Promedio de ventas durante el período del Día de las Madres.",
    when: "Para preparar el stock de productos de regalo y decoración antes de ese evento comercial.",
    tag: "temporada",
  },
  {
    short: "P.1m",
    label: "Prom. Diario Últ. 1 mes",
    desc: "Promedio de ventas diarias de los últimos 30 días. Refleja la tendencia más reciente del producto.",
    when: "Cuando quieres capturar si el producto está en crecimiento o caída reciente. Muy sensible a eventos cortos.",
    tag: "reciente",
  },
  {
    short: "P.3m",
    label: "Prom. Diario Últ. 3 meses",
    desc: "Promedio de ventas diarias de los últimos 90 días.",
    when: "Balance entre tendencia reciente y estabilidad. Buen índice para productos con demanda moderadamente estable.",
    tag: "reciente",
  },
  {
    short: "P.6m",
    label: "Prom. Diario Últ. 6 meses",
    desc: "Promedio de ventas diarias de los últimos 180 días.",
    when: "Para productos con demanda estable. Suaviza las fluctuaciones de corto plazo y da una visión más robusta.",
    tag: "reciente",
  },
  {
    short: "I.AVG",
    label: "Índice Promedio Compuesto",
    desc: "Combinación ponderada de múltiples índices calculada automáticamente por el sistema. Integra el comportamiento histórico, la tendencia reciente y la estabilidad de la demanda en un solo número.",
    when: "Es el índice recomendado para decidir cuánto pedir. El sistema lo utiliza por defecto al generar la propuesta de reabastecimiento.",
    tag: "recomendado",
  },
];

const TAG_CONFIG = {
  principal:   { label: "Principal",   cls: "bg-primary/10 text-primary border-primary/30" },
  conservador: { label: "Conservador", cls: "bg-sky-500/10 text-sky-600 border-sky-300/40" },
  especial:    { label: "Por tipo de día", cls: "bg-violet-500/10 text-violet-600 border-violet-300/40" },
  temporada:   { label: "Temporada",   cls: "bg-amber-500/10 text-amber-600 border-amber-300/40" },
  reciente:    { label: "Tendencia",   cls: "bg-teal-500/10 text-teal-600 border-teal-300/40" },
  recomendado: { label: "Recomendado ★", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-300/40" },
};

export default function IndicesHelpModal({ open, onClose }) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden"
        style={{ maxWidth: "min(700px, 96vw)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <DialogHeader className="px-6 py-5 border-b border-border shrink-0 bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingUp size={18} className="text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">Guía de Índices de Venta</DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Qué significa cada indicador y cuándo usarlo para decidir cuánto pedir
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Intro */}
        <div className="px-6 py-3 bg-primary/5 border-b border-primary/10 shrink-0">
          <p className="text-xs text-primary/80 leading-relaxed">
            <strong>¿Cómo leer los índices?</strong> Todos expresan <em>unidades vendidas por día</em>.
            Si P.&gt;0 = 5.3, el producto vende ~5.3 unidades cada día que hay movimiento.
            Para calcular cuánto pedir: <strong>Índice × días de cobertura deseados − stock actual</strong>.
            El sistema hace este cálculo automáticamente usando <strong>I.AVG</strong>.
          </p>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm z-10">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground w-16">Código</th>
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground w-44">Nombre</th>
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Qué mide</th>
                <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground hidden md:table-cell">Cuándo usarlo</th>
              </tr>
            </thead>
            <tbody>
              {INDICES.map((idx, i) => {
                const tag = TAG_CONFIG[idx.tag];
                const isRecommended = idx.tag === "recomendado";
                return (
                  <tr
                    key={idx.short}
                    className={`border-b border-border/50 last:border-0 align-top ${isRecommended ? "bg-emerald-50/60" : i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {isRecommended && <Star size={11} className="text-emerald-600 shrink-0" fill="currentColor" />}
                        <code className={`font-bold font-mono text-sm ${isRecommended ? "text-emerald-700" : "text-primary"}`}>
                          {idx.short}
                        </code>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground leading-tight mb-1">{idx.label}</div>
                      <Badge variant="outline" className={`text-[10px] border ${tag.cls}`}>{tag.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground leading-relaxed max-w-[220px]">
                      {idx.desc}
                    </td>
                    <td className="px-4 py-3 text-foreground/70 leading-relaxed hidden md:table-cell max-w-[180px]">
                      {idx.when}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t border-border bg-muted/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap size={12} className="text-emerald-600" />
            <span>El sistema usa <strong className="text-foreground">I.AVG</strong> por defecto para calcular las propuestas de reabastecimiento.</span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-xs px-4 py-1.5 rounded-lg border border-border bg-background hover:bg-muted transition-colors font-medium"
          >
            Cerrar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
