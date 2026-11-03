import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Settings2, Edit2, AlertTriangle, CheckCircle2, Loader2, Info } from "lucide-react";
import {
  getSystemVariables,
  updateSystemVariable,
  getSupplierOverridesForVariable,
  deleteAllOverridesForVariable,
} from "@/api/systemVariablesClient";

function fmtValue(variable) {
  const num = parseFloat(variable.value);
  if (isNaN(num)) return String(variable.value ?? "—");
  if (variable.unit === "%") return `${(num * 100).toFixed(2)}%`;
  if (variable.unit === "CUP") return `${num.toFixed(2)} CUP`;
  if (variable.unit === "USD") return `$${num.toFixed(4)}`;
  return String(num);
}

function inputToStored(rawInput, unit) {
  const n = parseFloat(rawInput);
  if (isNaN(n)) return null;
  return unit === "%" ? n / 100 : n;
}

function storedToInput(variable) {
  const num = parseFloat(variable.value);
  if (isNaN(num)) return "";
  if (variable.unit === "%") return (num * 100).toFixed(2);
  if (variable.unit === "USD") return num.toFixed(4);
  return String(num);
}

export default function SystemVariablesConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editingVar, setEditingVar] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: variables = [], isLoading } = useQuery({
    queryKey: ["system-variables"],
    queryFn: getSystemVariables,
    staleTime: 5 * 60 * 1000,
  });

  const { data: overrides = [], isLoading: loadingOverrides } = useQuery({
    queryKey: ["supplier-overrides-for-var", editingVar?.id],
    queryFn: () => getSupplierOverridesForVariable(editingVar.id),
    enabled: !!editingVar?.id,
    staleTime: 0,
  });

  function openEdit(v) {
    setEditingVar(v);
    setInputValue(storedToInput(v));
    setApplyToAll(false);
    setSaving(false);
  }

  function closeEdit() {
    if (saving) return;
    setEditingVar(null);
    setInputValue("");
    setApplyToAll(false);
  }

  async function handleSave() {
    if (!editingVar) return;
    const storedValue = inputToStored(inputValue, editingVar.unit);
    if (storedValue === null) {
      toast({ title: "Valor inválido", description: "Ingresa un número válido.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updateSystemVariable(editingVar.id, storedValue);
      if (applyToAll && overrides.length > 0) {
        await deleteAllOverridesForVariable(editingVar.id);
      }
      queryClient.invalidateQueries({ queryKey: ["system-variables"] });
      toast({
        title: "Variable actualizada",
        description: `"${editingVar.label}" actualizado correctamente.`,
        duration: 3000,
      });
      closeEdit();
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err?.message ?? "No se pudo actualizar la variable.",
        variant: "destructive",
        duration: 4000,
      });
      setSaving(false);
    }
  }

  const inputHint =
    editingVar?.unit === "%" ? "Ingresa el porcentaje — ej. 5 para 5%, 16 para 16%"
    : editingVar?.unit === "CUP" ? "Ingresa el valor en CUP"
    : editingVar?.unit === "USD" ? "Ingresa el valor en USD"
    : "Ingresa el valor numérico";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Settings2 size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Variables Globales de Precios</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Parámetros base del cálculo de Precio Propuesto TKC para todos los proveedores.
            </p>
          </div>
        </div>
        {!isLoading && (
          <Badge variant="secondary" className="text-xs self-start sm:self-auto shrink-0">
            {variables.length} variables activas
          </Badge>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-800 dark:text-blue-200">
        <Info size={14} className="shrink-0 mt-0.5 text-blue-500" />
        <p>
          Al modificar un valor puedes elegir si el cambio se aplica también a los proveedores
          con valores personalizados, o si estos mantienen su excepción.
          Los proveedores sin excepción siempre usan el valor global.
        </p>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm py-12">
          <Loader2 size={18} className="animate-spin" />
          Cargando variables...
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Etiqueta</th>
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden md:table-cell">Clave</th>
                  <th className="px-4 py-2.5 text-right font-medium text-xs text-muted-foreground">Valor Global</th>
                  <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground hidden sm:table-cell">Actualizado</th>
                  <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground w-24">Acción</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium">{v.label}</span>
                      {v.description && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight hidden sm:block">
                          {v.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <code className="text-[11px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                        {v.key}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono font-semibold text-primary">{fmtValue(v)}</span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {v.updated_at
                          ? new Date(v.updated_at).toLocaleDateString("es", {
                              day: "2-digit", month: "short", year: "numeric",
                            })
                          : "—"}
                      </span>
                      {v.updated_by && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate max-w-[130px]">
                          {v.updated_by}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1.5 px-2"
                        onClick={() => openEdit(v)}
                      >
                        <Edit2 size={12} />
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingVar} onOpenChange={(open) => { if (!open) closeEdit(); }}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Edit2 size={15} />
              Editar Variable
            </DialogTitle>
            <DialogDescription asChild>
              <div>
                <span className="font-medium text-foreground">{editingVar?.label}</span>
                {editingVar?.description && (
                  <span className="block text-muted-foreground text-xs mt-0.5">{editingVar.description}</span>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="var-input" className="text-sm font-medium">
                Nuevo valor
                {editingVar?.unit && (
                  <span className="ml-1 text-muted-foreground font-normal">({editingVar.unit})</span>
                )}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="var-input"
                  type="number"
                  step="any"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  className="text-right font-mono"
                  placeholder="0"
                  autoFocus
                />
                {editingVar?.unit && (
                  <span className="text-sm text-muted-foreground w-10 shrink-0 font-mono">
                    {editingVar.unit}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{inputHint}</p>
              <p className="text-[11px] text-muted-foreground">
                Valor actual:{" "}
                <strong className="font-mono">{editingVar ? fmtValue(editingVar) : "—"}</strong>
              </p>
            </div>

            {/* Supplier overrides section */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Proveedores con valores personalizados</p>
              {loadingOverrides ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Loader2 size={12} className="animate-spin" />
                  Verificando excepciones...
                </div>
              ) : overrides.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                  Ningún proveedor tiene valor personalizado para esta variable.
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={13} className="shrink-0" />
                    <span>
                      <strong>{overrides.length}</strong>{" "}
                      proveedor{overrides.length !== 1 ? "es tienen" : " tiene"} valores personalizados.
                    </span>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyToAll}
                      onChange={(e) => setApplyToAll(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-xs text-foreground leading-snug">
                      Aplicar también a estos proveedores
                      <span className="block text-muted-foreground mt-0.5">
                        Sus excepciones se eliminarán; usarán el nuevo valor global.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-1.5">
            <Button variant="outline" onClick={closeEdit} disabled={saving} className="h-8 text-xs">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || inputValue === ""}
              className="h-8 text-xs gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} />
                  Guardar cambio
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
