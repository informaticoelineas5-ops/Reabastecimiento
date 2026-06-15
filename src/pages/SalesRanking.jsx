import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchSalesIndices } from "@/api/salesIndicesClient";
import { fetchProductsForAlmacen } from "@/api/externalSupabaseClient";
import { getUserPreferences } from "@/api/userPreferencesClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Search, Warehouse } from "lucide-react";

const PAGE_SIZE = 100;

export default function SalesRanking() {
  const [almacenFilter, setAlmacenFilter] = useState("all");
  const [search, setSearch]               = useState("");
  const [catFilter, setCatFilter]         = useState("");
  const [catVFilter, setCatVFilter]       = useState("");
  const [page, setPage]                   = useState(0);

  // Preferencias del usuario
  const { data: userPrefs } = useQuery({
    queryKey: ["user-preferences"],
    queryFn:  getUserPreferences,
    staleTime: 5 * 60 * 1000,
  });

  const configuredAlmacenes = userPrefs?.almacenes?.length
    ? userPrefs.almacenes
    : (userPrefs?.almacen ? [userPrefs.almacen] : []);

  // Índices de venta (caché compartida con Catálogo)
  const { data: salesMap = new Map(), isLoading: loadingMap } = useQuery({
    queryKey:  ["sales-indices-db"],
    queryFn:   fetchSalesIndices,
    staleTime: 30 * 60 * 1000,
  });

  // Productos de TODOS los almacenes configurados en paralelo
  const { data: productsMap = new Map(), isLoading: loadingProducts } = useQuery({
    queryKey:  ["ranking-products-multi", configuredAlmacenes],
    queryFn:   async () => {
      if (!configuredAlmacenes.length) return new Map();
      const maps = await Promise.all(
        configuredAlmacenes.map(a => fetchProductsForAlmacen(a))
      );
      const merged = new Map();
      configuredAlmacenes.forEach((almacen, idx) => {
        maps[idx].forEach((p, key) => {
          merged.set(key, { ...p, proveedor: almacen });
        });
      });
      return merged;
    },
    staleTime: 10 * 60 * 1000,
    enabled:   configuredAlmacenes.length > 0,
  });

  const isLoading = loadingMap || loadingProducts;

  // Join: productos enriquecidos con índices, ordenados por Prom >0 desc
  const ranked = useMemo(() => {
    return [...productsMap.entries()]
      .map(([id, p]) => {
        const idx = salesMap.get(id);
        return {
          id_tienda:         id,
          nombre:            p.nombre,
          codigo:            p.codigo,
          categoria_online:  p.categoria_online,
          suministrador:     p.suministrador,
          proveedor:         p.proveedor,
          existencia_fisica: (p.cantidad ?? 0) + (p.reserved_qty ?? 0),
          ...(idx ?? {}),
        };
      })
      .sort((a, b) => (b.prom_ventas_diario_mayor_0 ?? 0) - (a.prom_ventas_diario_mayor_0 ?? 0));
  }, [productsMap, salesMap]);

  // Categorías únicas del conjunto completo
  const categories = useMemo(() =>
    [...new Set(ranked.map(p => p.categoria_online).filter(Boolean))].sort(),
  [ranked]);

  // Filtros: almacén local + categoría + Cat.V + búsqueda
  const filtered = useMemo(() => {
    let list = ranked;
    if (almacenFilter !== "all") list = list.filter(p => p.proveedor === almacenFilter);
    if (catFilter)               list = list.filter(p => p.categoria_online === catFilter);
    if (catVFilter)              list = list.filter(p => p.categoriaVentas === catVFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.nombre?.toLowerCase().includes(q) ||
        p.codigo?.toLowerCase().includes(q) ||
        String(p.id_tienda).includes(q)
      );
    }
    return list;
  }, [ranked, almacenFilter, catFilter, catVFilter, search]);

  const handleAlmacenChange = (v) => {
    setAlmacenFilter(v);
    setCatFilter("");
    setSearch("");
    setPage(0);
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <TrendingUp size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Ranking de Ventas</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isLoading
                ? "Cargando..."
                : `${ranked.length.toLocaleString()} productos · ordenados por Prom. Diario >0`
              }
            </p>
          </div>
        </div>
      </div>

      {/* Filtro de almacén */}
      <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border flex-wrap">
        <Warehouse size={16} className="text-muted-foreground shrink-0" />
        <span className="text-sm font-medium shrink-0">Ver almacén:</span>

        {configuredAlmacenes.length > 0 ? (
          <Select value={almacenFilter} onValueChange={handleAlmacenChange}>
            <SelectTrigger className="w-[300px] h-9 bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                Todos mis almacenes ({configuredAlmacenes.length})
              </SelectItem>
              {configuredAlmacenes.map(a => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Link to="/SalesIndexImport" className="text-xs text-warning underline">
            Configura tus almacenes en Índices de Ventas
          </Link>
        )}

        {!isLoading && configuredAlmacenes.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {(almacenFilter === "all" ? ranked : filtered).length.toLocaleString()} productos
          </Badge>
        )}
      </div>

      {/* Filtros secundarios */}
      {!isLoading && ranked.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Buscar producto..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="pl-8 h-8 text-xs w-52"
            />
          </div>
          <Select value={catFilter || "all"} onValueChange={v => { setCatFilter(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-52">
              <SelectValue placeholder="Todas las categorías" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={catVFilter || "all"} onValueChange={v => { setCatVFilter(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="h-8 text-xs w-36">
              <SelectValue placeholder="Cat.V" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Cat.V</SelectItem>
              <SelectItem value="A">A — Top 20%</SelectItem>
              <SelectItem value="B">B — 20–50%</SelectItem>
              <SelectItem value="C">C — 50–80%</SelectItem>
              <SelectItem value="D">D — Últimos 20%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      )}

      {/* Sin almacenes configurados */}
      {!isLoading && configuredAlmacenes.length === 0 && (
        <div className="text-center py-20 text-muted-foreground">
          <Warehouse size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Configura tus almacenes en Índices de Ventas</p>
          <Link to="/SalesIndexImport">
            <Button size="sm" className="mt-3">Ir a configuración</Button>
          </Link>
        </div>
      )}

      {/* Sin datos */}
      {!isLoading && configuredAlmacenes.length > 0 && ranked.length === 0 && (
        <div className="p-10 text-center space-y-2">
          <TrendingUp size={32} className="mx-auto text-muted-foreground opacity-30" />
          <p className="text-sm font-medium">Sin datos de ranking</p>
          <p className="text-xs text-muted-foreground">No se encontraron productos con índices de venta.</p>
        </div>
      )}

      {/* Leyenda + Tabla */}
      {!isLoading && ranked.length > 0 && (
        <>
          <div className="flex gap-4 text-xs flex-wrap items-center">
            <span className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Cat.V</span>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-emerald-600 text-white">A</Badge> Top 20%</div>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-emerald-100 text-emerald-800">B</Badge> 20–50%</div>
            <div className="flex items-center gap-1"><Badge className="text-[10px] bg-yellow-100 text-yellow-700">C</Badge> 50–80%</div>
            <div className="flex items-center gap-1"><Badge variant="outline" className="text-[10px]">D</Badge> Últimos 20%</div>
            <span className="text-muted-foreground ml-2 text-[10px]">· Sin Cat.V = producto sin ventas registradas</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground w-10">#</th>
                  <th className="px-3 py-2 text-center font-medium text-emerald-700 w-14">Cat.V</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground min-w-[200px]">Producto</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Categoría</th>
                  {configuredAlmacenes.length > 1 && almacenFilter === "all" && (
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Almacén</th>
                  )}
                  <th className="px-3 py-2 text-right font-medium text-primary" title="Promedio diario >0">P.&gt;0</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Promedio ≥ max/2">P.≥½</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Promedio Últ. 1 mes">P.1m</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground" title="Índice AVG">I.AVG</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Exist.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((p, i) => {
                  const globalIdx = page * PAGE_SIZE + i;
                  const catVStyle =
                    p.categoriaVentas === "A" ? "bg-emerald-600 text-white" :
                    p.categoriaVentas === "B" ? "bg-emerald-100 text-emerald-800" :
                    p.categoriaVentas === "C" ? "bg-yellow-100 text-yellow-700" :
                    p.categoriaVentas === "D" ? "bg-gray-100 text-gray-500" : "";

                  return (
                    <tr key={`${p.id_tienda}-${p.proveedor}`}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 text-center text-muted-foreground">{globalIdx + 1}</td>
                      <td className="px-3 py-2 text-center">
                        {p.categoriaVentas
                          ? <Badge className={`text-[10px] ${catVStyle}`}>{p.categoriaVentas}</Badge>
                          : <span className="text-muted-foreground">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 max-w-[220px]">
                        <p className="font-medium truncate">{p.nombre || "—"}</p>
                        <p className="text-muted-foreground text-[10px]">{p.codigo} · {p.id_tienda}</p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[150px] truncate">
                        {p.categoria_online || "—"}
                      </td>
                      {configuredAlmacenes.length > 1 && almacenFilter === "all" && (
                        <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate text-[10px]">
                          {p.proveedor}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-bold text-primary">
                        {p.prom_ventas_diario_mayor_0 != null ? p.prom_ventas_diario_mayor_0.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {p.prom_ventas_diario_top_max_2 != null ? p.prom_ventas_diario_top_max_2.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {p.prom_ventas_diario_ult_1_mes != null ? p.prom_ventas_diario_ult_1_mes.toFixed(3) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {p.indiceAvg != null ? p.indiceAvg.toFixed(3) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${p.existencia_fisica === 0 ? "text-destructive" : ""}`}>
                        {p.existencia_fisica}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {(() => {
            const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
            const from = page * PAGE_SIZE + 1;
            const to   = Math.min((page + 1) * PAGE_SIZE, filtered.length);
            return (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {from.toLocaleString()}–{to.toLocaleString()} de {filtered.length.toLocaleString()}
                  {filtered.length !== ranked.length && ` filtrados (${ranked.length.toLocaleString()} total)`}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                      Anterior
                    </Button>
                    <Badge variant="secondary" className="px-3 py-1">
                      {page + 1} / {totalPages}
                    </Badge>
                    <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                      Siguiente
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
