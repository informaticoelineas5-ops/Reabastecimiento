import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardCheck, Save, Search, Loader2, ChevronLeft, ChevronRight, Info, Warehouse } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { fetchAlmacenes } from "@/api/externalSupabaseClient";
import { useIndgAlmacenes } from "@/hooks/useIndgAlmacenes";
import { loadUnitsPerBox, saveUnitsPerBox } from "@/api/unitsPerBoxStore";
import SearchSelect from "@/components/common/SearchSelect";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

// "TKC SUB 1053" → 1053 · "TKC SUB 593 UP" → 593 · "B23 Electrocuba SV (1201)" → 1201
const claveDeAlmacen = (nombre) =>
  Number(nombre.match(/\((\d+)\)/)?.[1] ?? nombre.match(/(\d+)/)?.[1] ?? Infinity);

const FILTROS = [
  ["todos", "Todos"],
  ["sin",   "Sin U/C"],
  ["con",   "Con U/C"],
];

export default function UCPendientes() {
  const { toast } = useToast();

  const [almacen,  setAlmacen]  = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtro,   setFiltro]   = useState("todos");
  const [page,     setPage]     = useState(1);
  const [guardados, setGuardados] = useState({});  // código → U/C ya guardado
  const [borradores, setBorradores] = useState({}); // código → texto que el usuario está escribiendo
  const [savingCod, setSavingCod] = useState(null);

  // U/C guardados anteriormente
  useEffect(() => {
    loadUnitsPerBox().then(setGuardados).catch(() => {});
  }, []);

  // ── Almacenes ───────────────────────────────────────────────────────────────
  const { data: almacenesRaw = [] } = useQuery({
    queryKey: ["ext-almacenes"],
    queryFn: fetchAlmacenes,
    staleTime: 10 * 60 * 1000,
  });
  const almacenes = useMemo(
    () => [...almacenesRaw].sort((a, b) => claveDeAlmacen(a) - claveDeAlmacen(b) || a.localeCompare(b)),
    [almacenesRaw],
  );

  // ── Productos del almacén elegido (catálogo de Elineas) ─────────────────────
  // Una sola carga por almacén (reporte indg_ap_sub), compartida con el resto de vistas
  const indg = useIndgAlmacenes(almacen ? [almacen] : [], !!almacen);
  const productsMap = indg.products;
  const isLoading = !!almacen && !indg.finished && !indg.error;
  const isError = !!indg.error;
  const error = indg.error;
  const refetch = indg.reload;

  // Un producto por código (el catálogo trae una entrada por tienda)
  const productos = useMemo(() => {
    const porCodigo = new Map();
    for (const p of productsMap?.values() ?? []) {
      const codigo = String(p.codigo ?? "").trim();
      if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, { codigo, nombre: p.nombre ?? "" });
    }
    return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [productsMap]);

  const conUC = useMemo(() => productos.filter(p => guardados[p.codigo]).length, [productos, guardados]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return productos.filter(p => {
      if (filtro === "sin" &&  guardados[p.codigo]) return false;
      if (filtro === "con" && !guardados[p.codigo]) return false;
      if (!q) return true;
      return p.codigo.toLowerCase().includes(q) || p.nombre.toLowerCase().includes(q);
    });
  }, [productos, busqueda, filtro, guardados]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const pagina     = Math.min(page, totalPages);
  const visibles   = filtrados.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  const cambiarAlmacen = (v) => { setAlmacen(v); setPage(1); setBorradores({}); };
  const cambiarFiltro  = (v) => { setFiltro(v);  setPage(1); };
  const cambiarBusqueda = (v) => { setBusqueda(v); setPage(1); };

  const valorMostrado = (codigo) => borradores[codigo] ?? (guardados[codigo] != null ? String(guardados[codigo]) : "");

  const guardar = async (p) => {
    const uc = Number(borradores[p.codigo]);
    if (!Number.isInteger(uc) || uc <= 0) {
      toast({ description: "Introduce un número entero mayor que cero.", variant: "destructive", duration: 2500 });
      return;
    }
    setSavingCod(p.codigo);
    try {
      await saveUnitsPerBox(p.codigo, uc, p.nombre);
      setGuardados(prev => ({ ...prev, [p.codigo]: uc }));
      setBorradores(prev => { const n = { ...prev }; delete n[p.codigo]; return n; });
      toast({ description: `U/C guardado: ${p.codigo} → ${uc}`, duration: 2000 });
    } catch (err) {
      toast({ title: "No se pudo guardar", description: err.message, variant: "destructive", duration: 5000 });
    } finally {
      setSavingCod(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Título ─────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-semibold">Productos sin U/C</h1>
          <p className="text-xs text-muted-foreground">
            Asigna las "Unidades por Caja" de los productos de cada almacén para que el módulo de propuesta pueda calcular pedidos
          </p>
        </div>
      </div>

      {/* ── Aviso de guardado provisional ───────────────────── */}
      <div className="mx-6 mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          <strong>Guardado provisional:</strong> por ahora los U/C se guardan solo en este navegador. Todavía no se envían
          al servidor ni los ven otros usuarios.
        </span>
      </div>

      {/* ── Toolbar ────────────────────────────────────────── */}
      <div className="px-6 py-2 border-y bg-muted/30 flex items-center gap-3 flex-wrap">
        <span title="Almacén" aria-label="Almacén" className="text-muted-foreground"><Warehouse size={15} /></span>
        <SearchSelect
          value={almacen}
          onChange={cambiarAlmacen}
          options={almacenes}
          placeholder="Almacén…" size="xs" className="w-60"
        />

        {almacen && (
          <>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                value={busqueda}
                onChange={(e) => cambiarBusqueda(e.target.value)}
                placeholder="Buscar por código o nombre…"
                className="h-7 pl-7 text-xs w-52 bg-background"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Mostrar:</span>
              <div className="flex rounded-md border overflow-hidden">
                {FILTROS.map(([v, texto]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => cambiarFiltro(v)}
                    className={cn(
                      "px-2 h-6 text-[10px] font-medium transition-colors",
                      filtro === v ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {almacen && !isLoading && productos.length > 0 && (
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">{productos.length.toLocaleString()}</span> productos ·{" "}
            <span className="text-green-700 font-medium">{conUC.toLocaleString()}</span> con U/C ·{" "}
            <span className="text-amber-700 font-medium">{(productos.length - conUC).toLocaleString()}</span> sin U/C
          </div>
        )}
      </div>

      {/* ── Contenido ──────────────────────────────────────── */}
      <div className="overflow-auto flex-1 min-h-0 px-6 py-4">
        {!almacen ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
            <Warehouse className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">Selecciona un almacén para ver sus productos</p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-sm">Cargando productos del almacén…</p>
            <p className="text-xs">Los almacenes grandes pueden tardar hasta medio minuto.</p>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center h-48 text-center gap-2">
            <p className="text-sm font-medium text-destructive">No se pudieron cargar los productos</p>
            <p className="text-xs text-muted-foreground max-w-md">{error?.message}</p>
            <Button size="sm" variant="outline" className="h-7 text-xs mt-1" onClick={() => refetch()}>Reintentar</Button>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-muted-foreground gap-2">
            <ClipboardCheck className="h-8 w-8 opacity-30" />
            <p className="text-sm font-medium">
              {productos.length === 0 ? "Este almacén no tiene productos" : "Ningún producto coincide con la búsqueda o el filtro"}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-widest whitespace-nowrap select-text">Cód. TKC</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest select-text">Nombre</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest text-center whitespace-nowrap select-text">U/C</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest text-center whitespace-nowrap select-text">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((p) => {
                const guardado  = guardados[p.codigo];
                const borrador  = borradores[p.codigo];
                const cambiado  = borrador !== undefined && borrador !== "" && Number(borrador) !== guardado;
                const guardando = savingCod === p.codigo;
                return (
                  <TableRow key={p.codigo}>
                    <TableCell>
                      <span className="font-mono text-[11px] text-muted-foreground">{p.codigo}</span>
                    </TableCell>
                    <TableCell className="text-xs font-medium max-w-[460px] truncate" title={p.nombre}>{p.nombre}</TableCell>
                    <TableCell className="text-center">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="0"
                        value={valorMostrado(p.codigo)}
                        disabled={guardando}
                        onChange={(e) => setBorradores(prev => ({ ...prev, [p.codigo]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && cambiado && guardar(p)}
                        className={cn(
                          "w-20 h-7 text-center text-xs font-semibold tabular-nums mx-auto [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
                          guardado && !cambiado && "text-green-700 border-green-300",
                        )}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {cambiado ? (
                        <Button
                          size="sm" variant="outline" className="h-7 text-xs gap-1"
                          onClick={() => guardar(p)} disabled={guardando}
                        >
                          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                          Guardar
                        </Button>
                      ) : guardado ? (
                        <span className="text-xs text-green-600 font-semibold">✓ Guardado</span>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Paginación ─────────────────────────────────────── */}
      {almacen && !isLoading && !isError && totalPages > 1 && (
        <div className="px-6 py-2 border-t bg-background flex items-center justify-center gap-3 text-xs">
          <Button
            size="sm" variant="outline" className="h-7 gap-1 text-xs"
            disabled={pagina <= 1}
            onClick={() => setPage(pagina - 1)}
          >
            <ChevronLeft className="h-3 w-3" /> Anterior
          </Button>
          <span className="text-muted-foreground tabular-nums">
            Página {pagina} de {totalPages} · {filtrados.length.toLocaleString()} productos
          </span>
          <Button
            size="sm" variant="outline" className="h-7 gap-1 text-xs"
            disabled={pagina >= totalPages}
            onClick={() => setPage(pagina + 1)}
          >
            Siguiente <ChevronRight className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
