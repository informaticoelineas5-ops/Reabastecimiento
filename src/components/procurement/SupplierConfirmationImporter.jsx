import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { parsePdfToRows } from "@/utils/pdfParser";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, AlertCircle, CheckCircle2, Layers, ArrowRight, Minus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const CONF_FIELDS = [
  {
    key: "product_code",
    label: "Código del Producto",
    required: false,
    candidates: ["codigo", "código", "code", "cod", "sku", "ref", "codigo prov", "código prov"],
  },
  {
    key: "product_name",
    label: "Nombre del Producto",
    required: false,
    candidates: ["nombre", "producto", "name", "product", "descripcion", "articulo"],
  },
  {
    key: "confirmed_qty",
    label: "Cantidad Confirmada",
    required: true,
    candidates: ["cantidad confirmada", "cant confirmada", "confirmado", "confirmed", "cantidad", "cant", "qty", "unidades", "disponible", "disponibilidad"],
  },
];

const NONE = "__none__";

function detectCol(headers, candidates) {
  const norm = headers.map(h => (h || "").toString().toLowerCase().trim());
  for (const c of candidates) {
    const idx = norm.findIndex(x => x.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

function detectHeaderRow(rows) {
  const LIMIT = Math.min(rows.length, 30);
  let bestIdx = 0, bestScore = -1;
  for (let i = 0; i < LIMIT; i++) {
    const row = rows[i];
    const nonEmpty = row.filter(c => c !== null && c !== undefined && c !== "");
    const textCells = nonEmpty.filter(c => typeof c === "string" && c.length < 60);
    const score = textCells.length * 2 + nonEmpty.length;
    const nextNonEmpty = (rows[i + 1] || []).filter(c => c !== null && c !== undefined && c !== "").length;
    if (score > bestScore && nextNonEmpty >= 2) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function matchToOrderItems(parsedRows, orderItems) {
  const byCode     = new Map();
  const byNameFull = new Map();

  orderItems.forEach(item => {
    if (item.internal_product_code) {
      const k = item.internal_product_code.toString().toLowerCase().trim();
      byCode.set(k, item);
      // También indexar por valor numérico puro (maneja diferencias de formato en EAN/barcode)
      const numK = parseInt(k);
      if (!isNaN(numK)) byCode.set(String(numK), item);
    }
    if (item.product_name) {
      byNameFull.set(item.product_name.toString().toLowerCase().trim(), item);
    }
  });

  // usedIds evita asignar el mismo ítem del pedido a dos filas del archivo
  const usedIds = new Set();

  return parsedRows.map(row => {
    const rawCode = (row.product_code || "").toString().trim();
    const codeQ   = rawCode.toLowerCase();
    const nameQ   = (row.product_name || "").toString().trim().toLowerCase();
    let matched = null, matchType = "none";

    // 1. Coincidencia exacta de código
    if (codeQ) {
      const candidate = byCode.get(codeQ);
      if (candidate && !usedIds.has(candidate.id)) { matched = candidate; matchType = "code"; }
    }
    // 2. Coincidencia numérica (resuelve variaciones de formato en barcode/EAN)
    if (!matched && codeQ) {
      const numQ = String(parseInt(codeQ));
      if (!isNaN(parseInt(codeQ))) {
        const candidate = byCode.get(numQ);
        if (candidate && !usedIds.has(candidate.id)) { matched = candidate; matchType = "code"; }
      }
    }
    // 3. Coincidencia exacta de nombre
    if (!matched && nameQ) {
      const candidate = byNameFull.get(nameQ);
      if (candidate && !usedIds.has(candidate.id)) { matched = candidate; matchType = "name"; }
    }
    // 4. Coincidencia parcial de nombre — SÓLO entre ítems no usados
    if (!matched && nameQ) {
      for (const [key, item] of byNameFull.entries()) {
        if (!usedIds.has(item.id) && (key.includes(nameQ.slice(0, 15)) || nameQ.includes(key.slice(0, 15)))) {
          matched = item; matchType = "fuzzy"; break;
        }
      }
    }

    if (matched) usedIds.add(matched.id);

    return {
      rawCode,
      rawName:      row.product_name || "",
      confirmedQty: row.confirmed_qty,
      orderItem:    matched,
      matchType,
    };
  });
}

export default function SupplierConfirmationImporter({ orderId, orderItems, onImported }) {
  const [workbook,      setWorkbook]      = useState(null);
  const [file,          setFile]          = useState(null);
  const [sheets,        setSheets]        = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [allRows,       setAllRows]       = useState([]);
  const [headerRowIdx,  setHeaderRowIdx]  = useState(0);
  const [headers,       setHeaders]       = useState([]);
  const [preview,       setPreview]       = useState([]);
  const [colMap,        setColMap]        = useState({});
  const [matchedRows,   setMatchedRows]   = useState([]);
  const [step,          setStep]          = useState("upload"); // upload|sheet|map|preview|done
  const [saving,        setSaving]        = useState(false);
  const [progress,      setProgress]      = useState(0);
  const [error,         setError]         = useState(null);
  const fileRef   = useRef();
  const queryClient = useQueryClient();

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f); setError(null);

    if (f.name.toLowerCase().endsWith('.pdf')) {
      // ── PDF path ──
      try {
        const buffer = await f.arrayBuffer();
        const rows   = await parsePdfToRows(buffer);
        if (rows.length < 2) { setError("No se detectaron filas en el PDF. Verifica que no esté escaneado."); return; }
        setAllRows(rows);
        const hIdx = detectHeaderRow(rows);
        setHeaderRowIdx(hIdx);
        applyHeaderRow(rows, hIdx);
        setSelectedSheet("PDF");
        setWorkbook(null);
        setStep("map");
      } catch (err) {
        setError(`Error al leer el PDF: ${err.message}`);
      }
    } else {
      // ── Excel / CSV path ──
      const reader = new FileReader();
      reader.onload = (evt) => {
        const wb = XLSX.read(evt.target.result, { type: "binary" });
        setWorkbook(wb); setSheets(wb.SheetNames);
        if (wb.SheetNames.length === 1) loadSheet(wb, wb.SheetNames[0]);
        else setStep("sheet");
      };
      reader.readAsBinaryString(f);
    }
  };

  const applyHeaderRow = (rows, hIdx) => {
    const hdrs = rows[hIdx].map(h => (h || "").toString().trim());
    setHeaders(hdrs);
    setPreview(rows.slice(hIdx + 1, hIdx + 11));
    const map = {};
    for (const field of CONF_FIELDS) {
      const idx = detectCol(hdrs, field.candidates);
      map[field.key] = idx >= 0 ? idx : NONE;
    }
    setColMap(map);
  };

  const loadSheet = (wb, sheetName) => {
    setSelectedSheet(sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (rows.length < 2) { setError("La hoja no tiene filas de datos."); return; }
    setAllRows(rows);
    const hIdx = detectHeaderRow(rows);
    setHeaderRowIdx(hIdx);
    applyHeaderRow(rows, hIdx);
    setStep("map");
  };

  const handleHeaderRowChange = (delta) => {
    const newIdx = Math.max(0, Math.min(allRows.length - 2, headerRowIdx + delta));
    setHeaderRowIdx(newIdx);
    applyHeaderRow(allRows, newIdx);
  };

  const handlePreview = () => {
    const rows = workbook?.Sheets?.[selectedSheet]
      ? XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet], { header: 1, defval: "" })
      : allRows;
    const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ""));
    const parsed = dataRows.map(row => ({
      product_code: colMap.product_code !== NONE ? (row[colMap.product_code] || "").toString().trim() : "",
      product_name: colMap.product_name !== NONE ? (row[colMap.product_name] || "").toString().trim() : "",
      confirmed_qty: (() => {
        const v = colMap.confirmed_qty !== NONE ? row[colMap.confirmed_qty] : null;
        const n = parseFloat(String(v ?? ""));
        return isNaN(n) ? null : Math.round(n);
      })(),
    })).filter(r => r.confirmed_qty != null);
    setMatchedRows(matchToOrderItems(parsed, orderItems));
    setStep("preview");
  };

  const handleSave = async () => {
    setSaving(true);
    setProgress(10);
    const matched = matchedRows.filter(r => r.orderItem && r.confirmedQty != null);
    for (let i = 0; i < matched.length; i++) {
      const { orderItem, confirmedQty } = matched[i];
      await base44.entities.PurchaseOrderItem.update(orderItem.id, {
        confirmed_qty:      confirmedQty,
        acceptance_status:  "pending",
      });
      setProgress(10 + Math.round(((i + 1) / matched.length) * 80));
    }
    await base44.entities.PurchaseOrder.update(orderId, { confirmation_status: "imported" });
    setProgress(100);
    queryClient.invalidateQueries({ queryKey: ["purchase-order-items", orderId] });
    queryClient.invalidateQueries({ queryKey: ["purchase-order", orderId] });
    setSaving(false);
    setStep("done");
    onImported?.();
  };

  // ── Done ──
  if (step === "done") {
    const matched = matchedRows.filter(r => r.orderItem).length;
    return (
      <div className="flex items-center gap-3 text-success text-sm font-semibold py-4">
        <CheckCircle2 size={18} />
        Confirmación importada — {matched} ítem(s) actualizados
      </div>
    );
  }

  // ── Upload ──
  if (step === "upload") return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm font-medium">Sube el archivo de confirmación del proveedor</p>
        <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls), CSV o PDF</p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFile} />
      </div>
      {error && <p className="flex items-center gap-1.5 text-xs text-destructive"><AlertCircle size={12} />{error}</p>}
    </div>
  );

  // ── Sheet selection ──
  if (step === "sheet") return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <FileText size={14} className="text-primary" />
        <span className="font-medium">{file.name}</span>
        <Badge variant="secondary"><Layers size={11} className="mr-1 inline" />{sheets.length} hojas</Badge>
      </div>
      <div className="grid gap-2">
        {sheets.map(s => (
          <button key={s} onClick={() => loadSheet(workbook, s)}
            className="flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left">
            <span className="text-sm font-medium flex items-center gap-2"><Layers size={13} className="text-muted-foreground" />{s}</span>
            <ArrowRight size={13} className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );

  // ── Column mapping ──
  if (step === "map") {
    const missing = CONF_FIELDS.filter(f => f.required && (colMap[f.key] === NONE || colMap[f.key] === undefined));
    const hasIdentifier = colMap.product_code !== NONE || colMap.product_name !== NONE;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <FileText size={14} className="text-primary" />
          <span className="font-medium">{file.name}</span>
          {selectedSheet && <Badge variant="outline">Hoja: {selectedSheet}</Badge>}
          <Badge variant="secondary">{headers.length} columnas</Badge>
          <div className="flex items-center gap-1 ml-auto bg-muted rounded-md px-2 py-1">
            <span className="text-[10px] text-muted-foreground">Encabezados fila:</span>
            <button onClick={() => handleHeaderRowChange(-1)} className="px-1 font-bold text-muted-foreground hover:text-foreground">−</button>
            <span className="text-xs font-mono font-semibold w-4 text-center">{headerRowIdx + 1}</span>
            <button onClick={() => handleHeaderRowChange(1)} className="px-1 font-bold text-muted-foreground hover:text-foreground">+</button>
          </div>
        </div>

        {/* Preview tabla */}
        <div className="overflow-auto max-h-40 border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr>{headers.map((h, i) => <th key={i} className="border-b border-border px-2 py-1.5 bg-muted text-left font-medium whitespace-nowrap sticky top-0">{h || `Col ${i+1}`}</th>)}</tr>
            </thead>
            <tbody>
              {preview.map((row, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {headers.map((_, ci) => <td key={ci} className="px-2 py-1 text-muted-foreground truncate max-w-[80px]">{(row[ci] || "").toString().slice(0, 25)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mapeo de campos */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/60 border-b border-border px-3 py-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mapeo de columnas</p>
          </div>
          <table className="w-full text-xs">
            <tbody>
              {CONF_FIELDS.map(field => {
                const val = colMap[field.key];
                return (
                  <tr key={field.key} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2.5 w-1/2">
                      <span className="font-medium">{field.label}</span>
                      {field.required && <span className="text-destructive ml-1">*</span>}
                      {val !== NONE && val !== undefined && <Badge variant="secondary" className="ml-2 text-[10px] py-0">auto</Badge>}
                    </td>
                    <td className="px-3 py-2.5 w-1/2">
                      <select
                        value={val === NONE || val === undefined ? NONE : val}
                        onChange={e => setColMap(prev => ({ ...prev, [field.key]: e.target.value === NONE ? NONE : parseInt(e.target.value) }))}
                        className={`w-full h-7 text-xs border rounded px-1.5 bg-background ${field.required && (val === NONE || val === undefined) ? "border-destructive" : "border-input"}`}
                      >
                        <option value={NONE}>— No mapear —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i+1}`}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!hasIdentifier && (
          <p className="text-xs text-warning flex items-center gap-1"><AlertCircle size={11} />Asigna al menos Código o Nombre para poder emparejar con el pedido.</p>
        )}

        <Button onClick={handlePreview} className="w-full" disabled={missing.length > 0 || !hasIdentifier}>
          <ArrowRight size={14} className="mr-2" /> Ver coincidencias
        </Button>
      </div>
    );
  }

  // ── Preview / confirm ──
  if (step === "preview") {
    const matched   = matchedRows.filter(r => r.orderItem);
    const unmatched = matchedRows.filter(r => !r.orderItem);
    const MATCH_BADGE = {
      code:  { label: "Código",  cls: "bg-green-100 text-green-700" },
      name:  { label: "Nombre",  cls: "bg-blue-100 text-blue-700" },
      fuzzy: { label: "Parcial", cls: "bg-yellow-100 text-yellow-700" },
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge className="bg-success/10 text-success border-success/20 text-xs">{matched.length} coincidencias</Badge>
          {unmatched.length > 0 && <Badge variant="outline" className="text-warning border-warning text-xs">{unmatched.length} sin coincidencia</Badge>}
        </div>

        <div className="overflow-auto max-h-80 border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Producto del proveedor</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Emparejado con</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cant. Pedida</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cant. Confirmada</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Diferencia</th>
                <th className="px-3 py-2 text-center font-medium text-muted-foreground">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {matchedRows.map((row, i) => {
                const diff  = row.orderItem ? (row.confirmedQty ?? 0) - (row.orderItem.final_qty ?? 0) : null;
                const pct   = row.orderItem && row.orderItem.final_qty ? Math.round(((row.confirmedQty ?? 0) / row.orderItem.final_qty) * 100) : null;
                const mb    = MATCH_BADGE[row.matchType];
                return (
                  <tr key={i} className={`border-b border-border/50 last:border-0 ${!row.orderItem ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      <p className="truncate max-w-[140px]">{row.rawName || row.rawCode}</p>
                      {row.rawCode && row.rawName && <p className="text-[10px] text-muted-foreground font-mono">{row.rawCode}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {row.orderItem ? (
                        <div>
                          <p className="font-medium truncate max-w-[130px]">{row.orderItem.product_name}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{row.orderItem.internal_product_code}</p>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Sin coincidencia</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{row.orderItem?.final_qty ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{row.confirmedQty ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {diff != null && (
                        <span className={diff < 0 ? "text-destructive font-semibold" : diff > 0 ? "text-success" : "text-muted-foreground"}>
                          {diff > 0 ? "+" : ""}{diff} {pct != null && diff !== 0 ? `(${pct}%)` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {mb ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${mb.cls}`}>{mb.label}</span> : <Minus size={12} className="mx-auto text-muted-foreground" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {saving && (
          <div className="space-y-1">
            <Progress value={progress} />
            <p className="text-xs text-center text-muted-foreground">Guardando... {progress}%</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setStep("map")}>← Volver</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving || matched.length === 0}>
            <CheckCircle2 size={14} className="mr-2" />
            Confirmar e importar {matched.length} ítem(s)
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
