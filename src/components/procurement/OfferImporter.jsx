import React, { useState, useRef, useEffect, useMemo } from "react";
import { parsePdfToRows } from "@/utils/pdfParser";
import { readSpreadsheetFile } from "@/utils/spreadsheet";
import {
  NONE, SYSTEM_FIELDS, normalizeStr, detectHeaderRow, detectMapping, detectCurrency, buildItems,
} from "@/utils/offerParsing";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, AlertCircle, CheckCircle2, Layers, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import OfferUpdateSummaryModal from "@/components/procurement/OfferUpdateSummaryModal";

const COMPARABLE_FIELDS = [
  "offered_cost", "supplier_product_name", "format",
  "availability", "supplier_description", "valid_until", "pack_multiple",
];

function compareItems(existingItems, newItems) {
  const byCode = new Map();
  const byName = new Map();

  for (const item of existingItems) {
    const code = normalizeStr(item.supplier_product_code);
    if (code) byCode.set(code, item);
    byName.set(normalizeStr(item.supplier_product_name), item);
  }

  const toInsert = [], toUpdate = [], unchanged = [], matchedIds = new Set();

  for (const newItem of newItems) {
    const code = normalizeStr(newItem.supplier_product_code);
    const name = normalizeStr(newItem.supplier_product_name);

    // Si el item trae código, buscar SOLO por código.
    // El fallback por nombre solo aplica para items sin código (evita falsos matches
    // entre productos distintos que comparten nombre pero tienen códigos diferentes).
    let existing = code ? (byCode.get(code) ?? null) : (byName.get(name) ?? null);

    if (!existing) {
      toInsert.push(newItem);
    } else {
      matchedIds.add(existing.id);
      const changes = {};
      for (const field of COMPARABLE_FIELDS) {
        const nv = newItem[field];
        if (nv !== undefined && nv !== null && nv !== "" && nv !== existing[field]) {
          changes[field] = nv;
        }
      }
      if (Object.keys(changes).length > 0) {
        toUpdate.push({ id: existing.id, changes, oldItem: existing, newItem });
      } else {
        unchanged.push(existing);
      }
    }
  }

  const notInNew = existingItems.filter((item) => !matchedIds.has(item.id));
  return { toInsert, toUpdate, unchanged, notInNew };
}

export default function OfferImporter({ offer, onImported }) {
  const [sheetsData, setSheetsData] = useState([]);   // hojas del archivo: [{ name, rows }]
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [allRows, setAllRows] = useState([]);      // todas las filas del sheet
  const [headerRowIdx, setHeaderRowIdx] = useState(0); // índice de fila de encabezados
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState([]);
  const [colMap, setColMap] = useState({});
  const [currency, setCurrency] = useState(offer?.default_currency || "USD");
  const [currencyTouched, setCurrencyTouched] = useState(false);   // el usuario eligió la moneda a mano
  const [useSections, setUseSections] = useState(true);            // filas de una sola celda = título de sección
  const [includeNoPrice, setIncludeNoPrice] = useState(false);     // importar también los productos sin precio
  const [step, setStep] = useState("upload"); // upload | sheet | map | confirm
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [updateSummary, setUpdateSummary] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef();
  const queryClient = useQueryClient();

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setDone(false);
    setUpdateSummary(null);

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
        setSheetsData([]);
        setStep("map");
      } catch (err) {
        setError(`Error al leer el PDF: ${err.message}`);
      }
    } else {
      // ── Excel / CSV / ODS path ──
      try {
        const { sheets: sh } = await readSpreadsheetFile(f);
        setSheetsData(sh);
        setSheets(sh.map((x) => x.name));
        if (sh.length === 1) loadSheet(sh, sh[0].name);
        else setStep("sheet");
      } catch (err) {
        setError(`No se pudo leer el archivo: ${err.message}`);
      }
    }
  };

  const applyHeaderRow = (rows, hIdx) => {
    const hdrs = rows[hIdx].map((h) => (h || "").toString().trim());
    setHeaders(hdrs);
    setPreview(rows.slice(hIdx + 1, hIdx + 21));
    setColMap(detectMapping(hdrs));
  };

  // La moneda se deduce del encabezado de la columna de precio ("PRECIO USD", "VENTA EUROS"…) salvo que el usuario la elija
  const detectedCurrency = useMemo(
    () => detectCurrency(allRows, headerRowIdx, colMap.offered_cost),
    [allRows, headerRowIdx, colMap.offered_cost]);
  useEffect(() => {
    if (!currencyTouched) setCurrency(detectedCurrency?.code ?? offer?.default_currency ?? "USD");
  }, [detectedCurrency, currencyTouched, offer?.default_currency]);

  const loadSheet = (sheetsArr, sheetName) => {
    setSelectedSheet(sheetName);
    setCurrencyTouched(false);
    const rows = sheetsArr.find((x) => x.name === sheetName)?.rows ?? [];
    if (rows.length < 2) { setError("La hoja seleccionada no tiene filas de datos."); return; }
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

  const handleSheetSelect = (sheetName) => {
    loadSheet(sheetsData, sheetName);
  };

  // Qué se va a importar, calculado con las columnas y opciones actuales
  const analysis = useMemo(
    () => (step === "map" && allRows.length ? buildItems(allRows, headerRowIdx, colMap, { currency, useSections, includeNoPrice }).stats : null),
    [step, allRows, headerRowIdx, colMap, currency, useSections, includeNoPrice]);

  const handleImport = async () => {
    setImporting(true);
    setProgress(5);

    // Obtener usuario actual para registrar quién importó
    let currentUser = null;
    try { currentUser = await base44.auth.me(); } catch (_) {}
    const importedBy = currentUser?.email || currentUser?.full_name || null;

    setProgress(15);

    // Interpretación de las filas (títulos de sección → categoría, sin precio, moneda, fechas…)
    const { items: dedupedItems, stats } = buildItems(allRows, headerRowIdx, colMap, { currency, useSections, includeNoPrice });
    const invalidRows = stats.sinNombre + stats.ignoradas;
    if (!dedupedItems.length) {
      setImporting(false);
      setError("No se encontró ningún producto para importar con las columnas elegidas.");
      return;
    }

    setProgress(25);

    // Traer TODOS los items existentes de esta oferta, página a página, desde la API de REAB
    // (máximo 200 por página; se ordena por row_number para que la paginación sea estable)
    let existingItems = [];
    {
      const PAGE = 200;
      let offset = 0;
      while (true) {
        const { data, total } = await base44.entities.SupplierOfferItem.filterPaginated(
          { offer_id: offer.id },
          { limit: PAGE, offset, orderBy: "row_number" },
        );
        existingItems = existingItems.concat(data ?? []);
        offset += PAGE;
        if ((data?.length ?? 0) < PAGE || existingItems.length >= (total ?? Infinity)) break;
      }
    }
    setProgress(40);

    // Comparar y categorizar
    const { toInsert, toUpdate, unchanged, notInNew } = compareItems(existingItems, dedupedItems);
    setProgress(50);

    // Asignar row_number a los nuevos items (usar reduce para evitar stack overflow con arrays grandes)
    const maxRowNum = existingItems.reduce((m, i) => Math.max(m, i.row_number || 0), 0);
    toInsert.forEach((item, idx) => {
      item.offer_id = offer.id;
      item.row_number = maxRowNum + idx + 1;
    });

    // Insertar nuevos en lotes
    const BATCH = 50;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      await base44.entities.SupplierOfferItem.bulkCreate(toInsert.slice(i, i + BATCH));
      setProgress(50 + Math.round(((i + BATCH) / Math.max(toInsert.length + toUpdate.length, 1)) * 35));
    }

    // Actualizar items modificados en lotes concurrentes
    const UPDATE_BATCH = 20;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      await Promise.all(
        toUpdate.slice(i, i + UPDATE_BATCH).map((u) =>
          base44.entities.SupplierOfferItem.update(u.id, u.changes)
        )
      );
      setProgress(50 + Math.round((toInsert.length + i + UPDATE_BATCH) / Math.max(toInsert.length + toUpdate.length, 1) * 35));
    }

    // Insertar historial de precios para los items cuyo costo cambió
    const priceChanges = toUpdate
      .filter((u) => u.changes.offered_cost !== undefined && u.changes.offered_cost !== u.oldItem.offered_cost)
      .map((u) => ({
        offer_item_id: u.id,
        old_cost: u.oldItem.offered_cost ?? null,
        new_cost: u.changes.offered_cost,
        imported_by: importedBy,
        source_file: file?.name || null,
      }));

    // El historial de precios es secundario: si no se puede guardar (p. ej. el rol no tiene permiso
    // de escritura en ese recurso) la importación de la oferta no debe fallar.
    if (priceChanges.length > 0) {
      try {
        await base44.entities.OfferItemPriceHistory.bulkCreate(priceChanges);
      } catch (err) {
        console.warn("[importación] no se pudo guardar el historial de precios:", err.message);
      }
    }

    setProgress(90);

    const totalItems = existingItems.length + toInsert.length;
    await base44.entities.SupplierOffer.update(offer.id, {
      total_rows: totalItems,
      valid_rows: totalItems,
      invalid_rows: invalidRows,
      source_file_name: file.name,
    });

    setProgress(100);

    const summary = {
      inserted: toInsert,
      updated: toUpdate,
      unchanged: unchanged.length,
      notInNew,
      totalExtracted: stats.filas,
      invalidRows,
      sections: stats.secciones,
      noPrice: stats.sinPrecio,
    };
    setUpdateSummary(summary);
    setSummaryOpen(true);
    setDone(true);
    setImporting(false);

    queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
    queryClient.invalidateQueries({ queryKey: ["offer-items-all", offer.id] });
    onImported?.();
  };

  // ── Done state ──
  if (done) {
    return (
      <>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600 font-semibold">
            <CheckCircle2 size={18} /> Oferta actualizada correctamente
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xl font-bold text-blue-700">{updateSummary?.inserted?.length ?? 0}</p>
              <p className="text-xs text-blue-600">Nuevos</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xl font-bold text-amber-700">{updateSummary?.updated?.length ?? 0}</p>
              <p className="text-xs text-amber-600">Actualizados</p>
            </div>
            <div className="bg-muted border border-border rounded-lg p-3">
              <p className="text-xl font-bold text-muted-foreground">{updateSummary?.unchanged ?? 0}</p>
              <p className="text-xs text-muted-foreground">Sin cambios</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setSummaryOpen(true)}>
            Ver detalle completo
          </Button>
        </div>
        <OfferUpdateSummaryModal
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          summary={updateSummary}
        />
      </>
    );
  }

  // ── Step: upload ──
  if (step === "upload") {
    return (
      <div className="space-y-4">
        <div
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Selecciona o arrastra un archivo</p>
          <p className="text-xs text-muted-foreground">Excel (.xlsx, .xls), CSV o PDF</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden" onChange={handleFile} />
        </div>
        {error && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle size={14} />{error}</div>}
      </div>
    );
  }

  // ── Step: sheet selection ──
  if (step === "sheet") {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <FileText size={15} className="text-primary" />
          <span className="font-medium">{file.name}</span>
          <Badge variant="secondary"><Layers size={11} className="mr-1 inline" />{sheets.length} hojas</Badge>
        </div>
        <p className="text-sm text-muted-foreground">El archivo tiene múltiples hojas. Selecciona la que contiene los datos de la oferta:</p>
        <div className="grid gap-2">
          {sheets.map((s) => (
            <button
              key={s}
              onClick={() => handleSheetSelect(s)}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Layers size={14} className="text-muted-foreground" />
                <span className="text-sm font-medium">{s}</span>
              </div>
              <ArrowRight size={14} className="text-muted-foreground" />
            </button>
          ))}
        </div>
        {error && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle size={14} />{error}</div>}
      </div>
    );
  }

  // ── Step: column mapping ──
  if (step === "map") {
    const missingRequired = SYSTEM_FIELDS.filter(f => f.required && (colMap[f.key] === NONE || colMap[f.key] === undefined));

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <FileText size={15} className="text-primary" />
          <span className="text-sm font-medium">{file.name}</span>
          {selectedSheet && <Badge variant="outline">Hoja: {selectedSheet}</Badge>}
          <Badge variant="secondary">{headers.length} columnas</Badge>
          {/* Selector de fila de encabezados */}
          <div className="flex items-center gap-1 ml-2 bg-muted rounded-md px-2 py-1">
            <span className="text-[10px] text-muted-foreground">Encabezados en fila:</span>
            <button onClick={() => handleHeaderRowChange(-1)} className="text-muted-foreground hover:text-foreground px-1 font-bold">−</button>
            <span className="text-xs font-mono font-semibold w-5 text-center">{headerRowIdx + 1}</span>
            <button onClick={() => handleHeaderRowChange(1)} className="text-muted-foreground hover:text-foreground px-1 font-bold">+</button>
          </div>
          {!file?.name.toLowerCase().endsWith('.pdf') && (
            <button onClick={() => setStep("sheet")} className="text-xs text-muted-foreground underline ml-auto">
              Cambiar hoja
            </button>
          )}
        </div>

        {/* Preview */}
        <div className="overflow-auto max-h-64 border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="border-b border-border px-2 py-1.5 bg-muted text-left font-medium whitespace-nowrap sticky top-0 z-10">
                    {h || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, ri) => (
                <tr key={ri} className="border-b border-border/50 last:border-0">
                  {headers.map((_, ci) => (
                    <td key={ci} className="px-2 py-1 text-muted-foreground truncate max-w-[100px]">
                      {(row[ci] || "").toString().slice(0, 30)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mapping table */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Mapeo de columnas — asigna cada campo del sistema a la columna del archivo
          </p>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Campo del sistema</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground w-1/2">Columna del archivo</th>
                </tr>
              </thead>
              <tbody>
                {SYSTEM_FIELDS.map((field) => {
                  const val = colMap[field.key];
                  const isAutoDetected = val !== NONE && val !== undefined;
                  return (
                    <tr key={field.key} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-medium">{field.label}</span>
                        {field.required && <span className="text-destructive ml-1">*</span>}
                        {isAutoDetected && !field.required && (
                          <Badge variant="secondary" className="ml-2 text-[10px] py-0">auto</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={val === NONE || val === undefined ? NONE : val}
                          onChange={(e) => {
                            const v = e.target.value;
                            setColMap(prev => ({ ...prev, [field.key]: v === NONE ? NONE : parseInt(v) }));
                          }}
                          className={`w-full h-7 text-xs border rounded px-1.5 bg-background ${
                            field.required && (val === NONE || val === undefined)
                              ? "border-destructive"
                              : "border-input"
                          }`}
                        >
                          <option value={NONE}>— No mapear —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {missingRequired.length > 0 && (
            <p className="text-xs text-destructive mt-1.5 flex items-center gap-1">
              <AlertCircle size={11} /> Campos obligatorios sin asignar: {missingRequired.map(f => f.label).join(", ")}
            </p>
          )}
        </div>

        {/* Qué se va a importar */}
        {analysis && (
          <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Qué se va a importar</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">{analysis.productos.toLocaleString()} productos</span>
              {analysis.secciones > 0 && <span className="px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-800" title="Filas de una sola celda: no son productos; su texto pasa a la categoría de los productos que siguen">{analysis.secciones} títulos de sección → categorías</span>}
              {analysis.sinPrecio > 0 && <span className="px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-800">{analysis.sinPrecio} sin precio {includeNoPrice ? "(se importan)" : "(se omiten)"}</span>}
              {analysis.sinNombre > 0 && <span className="px-2 py-1 rounded-md bg-muted border border-border text-muted-foreground">{analysis.sinNombre} filas sin nombre omitidas</span>}
              {analysis.repetidos > 0 && <span className="px-2 py-1 rounded-md bg-muted border border-border text-muted-foreground" title="El mismo código aparece más de una vez: se usa la primera">{analysis.repetidos} códigos repetidos</span>}
            </div>
            <div className="grid sm:grid-cols-2 gap-3 items-start">
              <div className="space-y-1.5">
                <label className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={useSections} onChange={(e) => setUseSections(e.target.checked)} className="mt-0.5" />
                  <span>Tratar las filas de una sola celda como <strong>títulos de sección</strong> (categoría), no como productos</span>
                </label>
                {colMap.offered_cost !== NONE && colMap.offered_cost !== undefined && (
                  <label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={includeNoPrice} onChange={(e) => setIncludeNoPrice(e.target.checked)} className="mt-0.5" />
                    <span>Importar también los productos <strong>sin precio</strong></span>
                  </label>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Moneda de los precios</label>
                <select
                  value={currency}
                  onChange={(e) => { setCurrency(e.target.value); setCurrencyTouched(true); }}
                  className="w-full h-8 text-xs border border-input rounded px-1.5 bg-background"
                >
                  {[...new Set([currency, "USD", "EUR", "CUP", "MLC", "GBP", "CAD"])].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-[10px] text-muted-foreground">
                  {detectedCurrency && !currencyTouched
                    ? `Detectada en el encabezado "${detectedCurrency.from}". Cámbiala si no es correcta.`
                    : currencyTouched ? "Elegida por ti." : "No se encontró la moneda en el archivo: se usa la de la oferta."}
                </p>
              </div>
            </div>
          </div>
        )}

        {importing && (
          <div className="space-y-1.5">
            <Progress value={progress} />
            <p className="text-xs text-center text-muted-foreground">Importando... {progress}%</p>
          </div>
        )}

        <Button
          onClick={handleImport}
          className="w-full"
          disabled={importing || missingRequired.length > 0}
        >
          <Upload size={15} className="mr-2" />
          Importar {headers.length > 0 ? `desde "${selectedSheet || file?.name}"` : "archivo"}
        </Button>
      </div>
    );
  }

  return null;
}