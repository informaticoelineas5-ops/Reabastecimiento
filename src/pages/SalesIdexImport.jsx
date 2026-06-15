import React, { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, Settings, Save, CheckCircle2, ChevronDown, X } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { fetchSalesIndices } from "@/api/salesIndicesClient";
import {
  SELECTABLE_INDICES,
  DEFAULT_SELECTED_INDICES,
  getUserPreferences,
  saveUserPreferences,
} from "@/api/userPreferencesClient";
import { fetchAlmacenes, fetchExtSuministradoresMulti } from "@/api/externalSupabaseClient";

function MultiSelect({ label, options, value, onChange, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(o => !o)}
          className="w-full h-9 border border-input rounded-md px-3 text-sm text-left flex items-center justify-between bg-background hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        >
          <span className={value.length === 0 ? "text-muted-foreground" : "font-medium"}>
            {value.length === 0 ? placeholder : `${value.length} seleccionado(s)`}
          </span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="absolute z-50 w-full top-full mt-1.5 border border-border rounded-md bg-popover shadow-md max-h-52 overflow-y-auto">
            {options.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">Sin opciones disponibles</p>
            )}
            {options.map(opt => (
              <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent cursor-pointer text-sm select-none">
                <Checkbox
                  checked={value.includes(opt)}
                  onCheckedChange={checked =>
                    onChange(checked ? [...value, opt] : value.filter(v => v !== opt))
                  }
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.map(v => (
            <Badge key={v} variant="secondary" className="text-[10px] gap-1 pl-2 pr-1">
              <span className="truncate max-w-[160px]">{v}</span>
              <button onClick={() => onChange(value.filter(x => x !== v))} className="ml-0.5 hover:text-destructive rounded-sm">
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SalesIndexConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedAlmacenes, setSelectedAlmacenes] = useState([]);
  const [selectedSuministradores, setSelectedSuministradores] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState(DEFAULT_SELECTED_INDICES);
  const [saving, setSaving] = useState(false);

  // Load user preferences on mount
  useEffect(() => {
    getUserPreferences()
      .then((prefs) => {
        if (prefs?.selected_indices?.length) {
          setSelectedIndices(prefs.selected_indices);
        }
        if (prefs?.almacenes?.length) {
          setSelectedAlmacenes(prefs.almacenes);
        } else if (prefs?.almacen) {
          setSelectedAlmacenes([prefs.almacen]);
        }
        if (prefs?.suministradores?.length) {
          setSelectedSuministradores(prefs.suministradores);
        }
      })
      .catch(() => {});
  }, []);

  // Query almacenes
  const { data: almacenes = [] } = useQuery({
    queryKey: ["ext-almacenes"],
    queryFn: fetchAlmacenes,
    staleTime: 10 * 60 * 1000,
  });

  // Query suministradores for selected almacenes
  const { data: suministradoresDisponibles } = useQuery({
    queryKey: ["ext-sumi-multi", selectedAlmacenes],
    queryFn: () => fetchExtSuministradoresMulti(selectedAlmacenes),
    enabled: selectedAlmacenes.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // When selectedAlmacenes changes, filter out suministradores that are no longer valid
  useEffect(() => {
    if (!suministradoresDisponibles) return; // query disabled or loading — skip
    if (suministradoresDisponibles.length > 0) {
      setSelectedSuministradores(prev =>
        prev.filter(s => suministradoresDisponibles.includes(s))
      );
    } else if (selectedAlmacenes.length === 0) {
      setSelectedSuministradores([]);
    }
  }, [suministradoresDisponibles, selectedAlmacenes.length]);

  // Sales map query
  const { data: salesMap = new Map(), isLoading: loadingSales } = useQuery({
    queryKey: ["sales-indices-db"],
    queryFn: fetchSalesIndices,
    staleTime: 30 * 60 * 1000,
  });

  // Build top 200 rows sorted by indiceAvg desc
  const tableRows = useMemo(() => {
    const rows = [];
    for (const [id, entry] of salesMap.entries()) {
      rows.push({ id_tienda: id, ...entry });
    }
    rows.sort((a, b) => {
      if (a.indiceAvg == null && b.indiceAvg == null) return 0;
      if (a.indiceAvg == null) return 1;
      if (b.indiceAvg == null) return -1;
      return b.indiceAvg - a.indiceAvg;
    });
    return rows.slice(0, 200);
  }, [salesMap]);

  const totalProducts = salesMap.size;

  const handleToggleIndex = (key) => {
    setSelectedIndices((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveUserPreferences({
        almacenes: selectedAlmacenes,
        suministradores: selectedSuministradores,
        selected_indices: selectedIndices,
      });
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      toast({
        title: "Configuración guardada",
        description: "Tus preferencias de almacenes, suministradores e índices han sido guardadas.",
        duration: 3000,
      });
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err?.message ?? "No se pudo guardar la configuración.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              Configuración de Índices de Ventas
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personaliza tus almacenes, suministradores e índices visibles en el Catálogo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs flex items-center gap-1.5">
            {loadingSales ? (
              <><div className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />Cargando índices...</>
            ) : (
              `${totalProducts.toLocaleString()} productos en índices`
            )}
          </Badge>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <CheckCircle2 size={14} className="mr-1.5 animate-pulse" />
                Guardando...
              </>
            ) : (
              <>
                <Save size={14} className="mr-1.5" />
                Guardar configuración
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Three-card grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Card 1: Almacenes */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Almacenes</h2>
            {selectedAlmacenes.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedAlmacenes.length}
              </Badge>
            )}
          </div>
          <MultiSelect
            label="Selecciona los almacenes que gestionas"
            options={almacenes}
            value={selectedAlmacenes}
            onChange={setSelectedAlmacenes}
            placeholder="Selecciona almacenes..."
          />
          <p className="text-xs text-muted-foreground">
            Estos almacenes aparecerán en el Catálogo y Ranking de Ventas.
          </p>
        </div>

        {/* Card 2: Suministradores */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Suministradores</h2>
            {selectedSuministradores.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedSuministradores.length}
              </Badge>
            )}
          </div>
          <MultiSelect
            label="Filtra por suministrador (opcional)"
            options={suministradoresDisponibles ?? []}
            value={selectedSuministradores}
            onChange={setSelectedSuministradores}
            placeholder={selectedAlmacenes.length === 0 ? "Selecciona almacenes primero" : "Todos los suministradores"}
            disabled={selectedAlmacenes.length === 0}
          />
          <p className="text-xs text-muted-foreground">
            Deja vacío para ver todos los suministradores de los almacenes seleccionados.
          </p>
        </div>

        {/* Card 3: Índices visibles */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Índices visibles en Catálogo</h2>
            <Badge variant="secondary" className="text-xs">
              {selectedIndices.length} / {SELECTABLE_INDICES.length} seleccionados
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {SELECTABLE_INDICES.map(({ key, label, short }) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={`idx-${key}`}
                  checked={selectedIndices.includes(key)}
                  onCheckedChange={() => handleToggleIndex(key)}
                />
                <Label
                  htmlFor={`idx-${key}`}
                  className="text-xs cursor-pointer leading-tight"
                  title={label}
                >
                  <span className="font-mono text-primary mr-1">{short}</span>
                  <span className="text-muted-foreground">{label}</span>
                </Label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Data table: top 200 products sorted by indiceAvg desc */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            {loadingSales ? (
              <><div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />Vista previa — Cargando datos...</>
            ) : (
              `Vista previa — Top ${tableRows.length} productos por I.AVG`
            )}
          </h2>
          {salesMap.size > 200 && (
            <span className="text-xs text-muted-foreground">
              Mostrando 200 de {salesMap.size.toLocaleString()} productos
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted/50 z-10 whitespace-nowrap">
                  ID Tienda
                </th>
                <th className="px-3 py-2 text-center font-medium">Cat.V</th>
                <th className="px-3 py-2 text-right font-medium">I.AVG</th>
                {SELECTABLE_INDICES.map(({ key, short, label }) => (
                  <th
                    key={key}
                    className={`px-3 py-2 text-right font-medium whitespace-nowrap transition-opacity ${
                      selectedIndices.includes(key) ? "opacity-100" : "opacity-30"
                    }`}
                    title={label}
                  >
                    {short}
                    {selectedIndices.includes(key) && (
                      <span className="ml-0.5 text-chart-2">✓</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row) => (
                <tr
                  key={row.id_tienda}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                >
                  <td className="px-3 py-1.5 font-mono text-primary sticky left-0 bg-card z-10">
                    {row.id_tienda}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {row.categoriaVentas != null ? (
                      <Badge
                        className={`text-[10px] ${
                          row.categoriaVentas === "A"
                            ? "bg-chart-2/15 text-chart-2"
                            : row.categoriaVentas === "B"
                            ? "bg-chart-3/15 text-chart-3"
                            : row.categoriaVentas === "C"
                            ? "bg-info/15 text-info"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {row.categoriaVentas}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">
                    {row.indiceAvg != null ? row.indiceAvg.toFixed(3) : "—"}
                  </td>
                  {SELECTABLE_INDICES.map(({ key }) => (
                    <td
                      key={key}
                      className={`px-3 py-1.5 text-right font-mono transition-opacity ${
                        selectedIndices.includes(key) ? "opacity-100" : "opacity-30"
                      }`}
                    >
                      {row[key] != null ? Number(row[key]).toFixed(3) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              {tableRows.length === 0 && (
                <tr>
                  <td
                    colSpan={3 + SELECTABLE_INDICES.length}
                    className="text-center text-muted-foreground py-12"
                  >
                    {loadingSales ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        <span>Cargando índices de ventas...</span>
                      </div>
                    ) : (
                      "No hay datos de índices disponibles."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {salesMap.size > 200 && (
          <div className="px-4 py-2 border-t border-border bg-muted/30 text-xs text-muted-foreground">
            Mostrando los primeros 200 productos ordenados por I.AVG descendente. Total:{" "}
            {salesMap.size.toLocaleString()} productos con índices.
          </div>
        )}
      </div>
    </div>
  );
}
