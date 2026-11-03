// ═══════════════════════════════════════════════════════════════════════════════
// RDP_VD · Sincronización diaria con Supabase
//
// Clave de negocio: (invoice_number, sell_date) — definida por el especialista de BD.
// Para filas sin factura (invoice_number nulo) se usa clave de reserva:
//   "NULL|sell_date|code" — evita falsos duplicados.
//
// Instalar:
//   1. Google Sheet → Extensiones → Apps Script → pegar este código
//   2. Configuración del proyecto → Propiedades del script:
//      SUPABASE_KEY = eyJhbGci... (service_role key)
//   3. Triggers → Agregar: sincronizarDiario · Diario · 06:00–07:00
// ═══════════════════════════════════════════════════════════════════════════════

const CFG = {
  SUPABASE_URL: 'https://fiftxvdgwrbjudjtfhhi.supabase.co',
  TABLE:        'RDP_VD',
  SHEET_NAME:   'I BD P VD',
  STATUS_COL:   7,     // columna H (0-based) = "Pasos VD"
  PAGE_SIZE:    1000,
  BATCH_INSERT: 200,
  BATCH_DELETE: 200,
};

// ── Auth ──────────────────────────────────────────────────────────────────────

function getKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('SUPABASE_KEY');
  if (!key) throw new Error('Falta SUPABASE_KEY en Propiedades del script.');
  return key;
}

// ── Clave de negocio compuesta ────────────────────────────────────────────────
// Usa invoice_number + sell_date cuando hay factura;
// cae a NULL|sell_date|code cuando no hay número de factura.

function makeKey_(invoiceNumber, sellDate, code) {
  const inv = (invoiceNumber != null && invoiceNumber !== '') ? invoiceNumber : 'NULL';
  return `${inv}|${sellDate}|${code}`;
}

// ── Estado "Pagado-Finalizado" (variantes) ────────────────────────────────────

function esPagado_(val) {
  const v = (val || '').toString().toLowerCase().replace(/[-–\s]+/g, '');
  return v.includes('pagado') && v.includes('finalizado');
}

// ── Fecha del sheet → 'YYYY-MM-DD' ───────────────────────────────────────────

function toISO_(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = val.toString().trim();
  const p = s.split('/');
  if (p.length === 3) {
    const [d, m, y] = p;
    return `20${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  }
  return null;
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

function sbGet_(path) {
  const key = getKey_();
  return UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/' + CFG.TABLE + path, {
    method: 'GET',
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    muteHttpExceptions: true,
  });
}

function sbPost_(payload) {
  const key = getKey_();
  return UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/' + CFG.TABLE, {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}

function sbDelete_(path) {
  const key = getKey_();
  return UrlFetchApp.fetch(CFG.SUPABASE_URL + '/rest/v1/' + CFG.TABLE + path, {
    method: 'DELETE',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=minimal',
    },
    muteHttpExceptions: true,
  });
}

// ── Leer registros de Supabase: id + campos clave (paginado) ──────────────────
// Devuelve Map<clave_negocio → id_supabase>

function fetchDbMap_() {
  const dbMap = new Map();
  let offset  = 0;

  while (true) {
    const res  = sbGet_(`?select=id,invoice_number,sell_date,code&limit=${CFG.PAGE_SIZE}&offset=${offset}`);
    const code = res.getResponseCode();
    if (code >= 400) throw new Error(`Supabase GET HTTP ${code}: ${res.getContentText()}`);

    const data = JSON.parse(res.getContentText());
    if (!data.length) break;

    data.forEach(r => {
      const k = makeKey_(r.invoice_number, r.sell_date, r.code);
      dbMap.set(k, r.id);
    });

    if (data.length < CFG.PAGE_SIZE) break;
    offset += CFG.PAGE_SIZE;
  }

  return dbMap;
}

// ── Insertar en lotes ─────────────────────────────────────────────────────────

function insertRows_(rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CFG.BATCH_INSERT) {
    const batch = rows.slice(i, i + CFG.BATCH_INSERT);
    const res   = sbPost_(batch);
    const code  = res.getResponseCode();
    if (code < 400) {
      inserted += batch.length;
    } else {
      Logger.log(`  ✗ Error INSERT lote ${i}: HTTP ${code} · ${res.getContentText().slice(0, 200)}`);
    }
  }
  return inserted;
}

// ── Eliminar por id interno de Supabase ───────────────────────────────────────

function deleteByIds_(ids) {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CFG.BATCH_DELETE) {
    const batch = ids.slice(i, i + CFG.BATCH_DELETE).join(',');
    const res   = sbDelete_(`?id=in.(${batch})`);
    const code  = res.getResponseCode();
    if (code < 400) {
      deleted += batch.split(',').length;
    } else {
      Logger.log(`  ✗ Error DELETE lote ${i}: HTTP ${code} · ${res.getContentText().slice(0, 200)}`);
    }
  }
  return deleted;
}

// ── Función principal ─────────────────────────────────────────────────────────

function sincronizarDiario() {
  const inicio = new Date();
  Logger.log('═══ Inicio sincronización RDP_VD · ' + inicio.toISOString() + ' ═══');

  // 1. Leer columnas A–H del sheet
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const data    = sheet.getRange(1, 1, lastRow, CFG.STATUS_COL + 1).getValues();
  Logger.log(`Sheet: ${data.length - 1} filas (sin cabecera)`);

  // 2. Filtrar "Pagado-Finalizado" y construir mapa por clave de negocio
  const sheetMap = new Map();   // clave → objeto a insertar
  let   omitidos = 0;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!esPagado_(r[CFG.STATUS_COL])) { omitidos++; continue; }

    const code      = (r[5] || '').toString().trim();
    const operator  = (r[6] || '').toString().trim();
    const sell_date = toISO_(r[2]);
    if (!code || !operator || !sell_date) { omitidos++; continue; }

    const price = parseFloat((r[4] || '').toString().replace(/[$,\s]/g, ''));
    if (isNaN(price)) { omitidos++; continue; }

    const invoice_number = r[0] ? (parseInt(r[0]) || null) : null;
    const qty            = parseFloat((r[3] || '0').toString().replace(/,/g, '.'));
    const key            = makeKey_(invoice_number, sell_date, code);

    sheetMap.set(key, {
      invoice_number,
      customer:    (r[1] || '').toString().trim() || null,
      sell_date,
      quantity:    isNaN(qty) ? 0 : qty,
      final_price: price,
      code,
      operator,
    });
  }

  Logger.log(`Sheet "Pagado-Finalizado": ${sheetMap.size} | Omitidos: ${omitidos}`);

  // 3. Leer claves + ids actuales de Supabase
  Logger.log('Leyendo Supabase...');
  const dbMap = fetchDbMap_();
  Logger.log(`Supabase registros actuales: ${dbMap.size}`);

  // 4. Diferencias
  //    toInsert: están en el sheet pero no en Supabase
  //    toDelete: están en Supabase pero ya no son Pagado-Finalizado en el sheet
  const toInsert = [];
  for (const [key, rec] of sheetMap) {
    if (!dbMap.has(key)) toInsert.push(rec);
  }

  const toDeleteIds = [];
  for (const [key, id] of dbMap) {
    if (!sheetMap.has(key)) toDeleteIds.push(id);
  }

  Logger.log(`Insertar: ${toInsert.length} | Eliminar: ${toDeleteIds.length}`);

  // 5. Ejecutar
  const inserted = toInsert.length    ? insertRows_(toInsert)       : 0;
  const deleted  = toDeleteIds.length ? deleteByIds_(toDeleteIds)   : 0;

  const seg = ((new Date() - inicio) / 1000).toFixed(1);
  Logger.log(`✓ Insertados: ${inserted} | Eliminados: ${deleted} | Tiempo: ${seg}s`);
  Logger.log('═══ Fin ═══');
}
