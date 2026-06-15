import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { parsePdfToRows } from "@/utils/pdfParser";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, AlertCircle, CheckCircle2, Layers, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

// System fields we need to map, with display labels and auto-detect candidates
const SYSTEM_FIELDS = [
  {
    key: "supplier_product_code",
    label: "Código Proveedor",
    required: false,
    candidates: ["codigo prov", "código prov", "código", "codigo", "code", "cod", "sku", "ref"],
  },
  {
    key: "supplier_product_name",
    label: "Nombre del Producto",
    required: true,
    candidates: ["producto", "nombre", "name", "product", "descripcion", "description", "articulo"],
  },
  {
    key: "offered_cost",
    label: "Precio (costo ofertado)",
    required: true,
    candidates: ["precio oferta", "precio", "price", "cost", "costo", "valor"],
  },
  {
    key: "unit",
    label: "Unidad",
    required: false,
    candidates: ["unidad", "unit", "um", "udm"],
  },
  {
    key: "pack_multiple",
    label: "Unidad por Caja / Múltiplo",
    required: false,
    candidates: ["unidad por caja", "unidades por caja", "pack", "multiplo", "multiple", "lote"],
  },
  {
    key: "min_qty",
    label: "Cantidad Mínima",
    required: false,
    candidates: ["minimo", "min qty", "cantidad minima", "cant min"],
  },
  {
    key: "availability",
    label: "Disponibilidad / Stock",
    required: false,
    candidates: ["disponibilidad unidades", "disponibilidad", "disponible", "availability", "stock"],
  },
  {
    key: "valid_until",
    label: "Fecha Catálogo / Vigencia",
    required: false,
    candidates: ["fecha catálogo", "fecha catalogo", "vigencia", "valid until", "vencimiento", "hasta"],
  },
  {
    key: "format",
    label: "Categoría / Formato",
    required: false,
    candidates: ["categoría", "categoria", "formato", "format", "presentacion"],
  },
  {
    key: "supplier_description",
    label: "Marca / Descripción",
    required: false,
    candidates: ["marca", "brand", "descripcion adicional"],
  },
  {
    key: "notes",
    label: "Proveedor / Notas",
    required: false,
    candidates: ["proveedor", "supplier", "observaciones", "notas", "notes", "comentarios"],
  },
];

function detectCol(headers, candidates) {
  const norm = headers.map((h) => (h || "").toString().toLowerCase().trim());
  for (const c of candidates) {
    const idx = norm.findIndex((x) => x.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

const NONE = "__none__";

/**
 * Detecta automáticamente la fila de encabezados buscando la que tiene
 * más celdas no vacías con texto (y la siguiente fila también tiene datos).
 * Ignora filas de cabecera corporativa, logos, etc.
 */
function detectHeaderRow(rows) {
  const SEARCH_LIMIT = Math.min(rows.length, 30);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < SEARCH_LIMIT; i++) {
    const row = rows[i];
    const nonEmpty = row.filter(c => c !== null && c !== undefined && c !== "");
    // Preferir filas con más celdas y que parezcan encabezados (strings cortos)
    const textCells = nonEmpty.filter(c => typeof c === "string" && c.length < 60);
    const score = textCells.length * 2 + nonEmpty.length;

    // La fila siguiente también debe tener datos
    const nextRow = rows[i + 1] || [];
    const nextNonEmpty = nextRow.filter(c => c !== null && c !== undefined && c !== "").length;

    if (score > bestScore && nextNonEmpty >= 2) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export default function OfferImporter({ offer, onImported }) {
  const [workbook, setWorkbook] = useState(null);
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [allRows, setAllRows] = useState([]);      // todas las filas del sheet
  const [headerRowIdx, setHeaderRowIdx] = useState(0); // índice de fila de encabezados
  const [headers, setHeaders] = useState([]);
  const [preview, setPreview] = useState([]);
  const [colMap, setColMap] = useState({});
  const [step, setStep] = useState("upload"); // upload | sheet | map | confirm
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef();
  const queryClient = useQueryClient();

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setError(null);
    setResult(null);

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
        setWorkbook(wb);
        setSheets(wb.SheetNames);
        if (wb.SheetNames.length === 1) {
          loadSheet(wb, wb.SheetNames[0]);
        } else {
          setStep("sheet");
        }
      };
      reader.readAsBinaryString(f);
    }
  };

  const applyHeaderRow = (rows, hIdx) => {
    const hdrs = rows[hIdx].map((h) => (h || "").toString().trim());
    setHeaders(hdrs);
    setPreview(rows.slice(hIdx + 1, hIdx + 21));
    const map = {};
    for (const field of SYSTEM_FIELDS) {
      const idx = detectCol(hdrs, field.candidates);
      map[field.key] = idx >= 0 ? idx : NONE;
    }
    setColMap(map);
  };

  const loadSheet = (wb, sheetName) => {
    setSelectedSheet(sheetName);
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
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
    loadSheet(workbook, sheetName);
  };

  const handleImport = async () => {
    setImporting(true);
    setProgress(10);

    const rows = workbook?.Sheets?.[selectedSheet]
      ? XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet], { header: 1, defval: "" })
      : allRows;
    const dataRows = rows.slice(headerRowIdx + 1).filter((r) => r.some((c) => c !== ""));
    setProgress(30);

    const nameIdx = colMap.supplier_product_name;
    const hasNameCol = nameIdx !== NONE && nameIdx !== undefined;

    let validRows = 0, invalidRows = 0;
    const items = [];

    dataRows.forEach((row, i) => {
      const name = hasNameCol ? (row[nameIdx] || "").toString().trim() : "";
      if (!name) { invalidRows++; return; }

      const item = {
        offer_id: offer.id,
        row_number: i + 2,
        supplier_product_name: name,
        is_valid: true,
        min_qty: 1,
        pack_multiple: 1,
        currency: offer.default_currency || "USD",
      };

      for (const field of SYSTEM_FIELDS) {
        if (field.key === "supplier_product_name") continue;
        const idx = colMap[field.key];
        if (idx === NONE || idx === undefined) continue;
        const val = row[idx];
        if (val === "" || val === undefined || val === null) continue;

        if (["offered_cost", "min_qty", "pack_multiple", "lead_time_days"].includes(field.key)) {
          const n = parseFloat(val);
          if (!isNaN(n)) item[field.key] = n;
        } else {
          item[field.key] = val.toString().trim();
        }
      }

      items.push(item);
      validRows++;
    });

    setProgress(50);
    const BATCH = 50;
    for (let i = 0; i < items.length; i += BATCH) {
      await base44.entities.SupplierOfferItem.bulkCreate(items.slice(i, i + BATCH));
      setProgress(50 + Math.round(((i + BATCH) / items.length) * 40));
    }

    await base44.entities.SupplierOffer.update(offer.id, {
      status: "imported",
      total_rows: dataRows.length,
      valid_rows: validRows,
      invalid_rows: invalidRows,
      source_file_name: file.name,
    });

    setProgress(100);
    setResult({ total: dataRows.length, validRows, invalidRows });
    queryClient.invalidateQueries({ queryKey: ["supplier-offers"] });
    queryClient.invalidateQueries({ queryKey: ["offer-items", offer.id] });
    setImporting(false);
    onImported?.();
  };

  // ── Result ──
  if (result) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-success font-semibold">
          <CheckCircle2 size={18} /> Importación completada
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-muted rounded-lg p-3"><p className="text-xl font-bold">{result.total}</p><p className="text-xs text-muted-foreground">Total filas</p></div>
          <div className="bg-success/10 rounded-lg p-3"><p className="text-xl font-bold text-success">{result.validRows}</p><p className="text-xs text-muted-foreground">Válidas</p></div>
          <div className="bg-destructive/10 rounded-lg p-3"><p className="text-xl font-bold text-destructive">{result.invalidRows}</p><p className="text-xs text-muted-foreground">Inválidas</p></div>
        </div>
      </div>
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