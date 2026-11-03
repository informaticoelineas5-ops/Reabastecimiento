/**
 * Sincroniza los proveedores de la hoja "BD C.Prov" con la API de REAB (POST /suppliers/bulk).
 *
 * - SOLO CREA los que faltan. Nunca modifica ni borra proveedores que ya existen.
 * - Cada ejecución compara la hoja contra lo que hay en la BD en ese momento, así que no guarda
 *   estado: sirve igual para la carga inicial (los que faltan hoy) y para la revisión diaria.
 * - Un proveedor "ya existe" si coincide su NOMBRE (sin tildes, mayúsculas ni signos) o su ID/código.
 * - Todo lo que hace queda anotado en la hoja "Sync API".
 *
 * Instalación: ver los pasos al final de este archivo.
 */

const CONFIG = {
  SHEET_NAME: 'BD C.Prov',       // hoja con el listado de proveedores
  HEADER_ROW: 1,                 // fila de los encabezados
  LOG_SHEET: 'Sync API',         // hoja donde se anota cada ejecución (se crea sola)
  AUTH_URL: 'https://apiauth.mercadoelineas.com/api/auth/sign-in',
  API_BASE: 'https://apireab.mercadoelineas.com/api/v1',
  NOTIFY_EMAIL: '',              // opcional: correo al que avisar si se agregó algo o hubo errores
  TRIGGER_HOUR: 7,               // hora del día (zona horaria del script) de la revisión diaria
  DEFAULT_CURRENCY: 'USD',       // igual que el formulario de Proveedores de la app
  DEFAULT_EXCHANGE_RATE: 1,
  BULK_SIZE: 500,                // proveedores por petición a /suppliers/bulk (máximo de la API)
  PAUSE_MS: 150,                 // pausa entre altas una a una (solo si hay que caer al modo individual)
};

// Encabezado de la hoja (sin tildes ni mayúsculas) → campo de la API.
// Se busca por NOMBRE de columna, así no importa si hay columnas ocultas o cambian de lugar.
const COLUMN_MAP = {
  'id': 'code',
  'proveedor': 'name',
  'tipo proveedor': 'supplier_type',
  'tipo comercializacion': 'comercializacion_type',
  'pais': 'country',
  'comercial': 'comercial',
  'contacto 1': 'contact_name', 'cargo 1': 'cargo_1', 'telefono 1': 'telefono_1',
  'contacto 2': 'contact_2',    'cargo 2': 'cargo_2', 'telefono 2': 'telefono_2',
  'contacto 3': 'contact_3',    'cargo 3': 'cargo_3', 'telefono 3': 'telefono_3',
  'contacto 4': 'contact_4',    'cargo 4': 'cargo_4', 'telefono 4': 'telefono_4',
  'contacto 5': 'contact_5',    'cargo 5': 'cargo_5', 'telefono 5': 'telefono_5',
};

// ═══════════════════════════════════════════════════════════════════════════
// Funciones que se ejecutan a mano (o desde el menú)
// ═══════════════════════════════════════════════════════════════════════════

/** PASO 1 · Muestra qué proveedores se agregarían, SIN crear nada. */
function previsualizarNuevos() { sync_(true); }

/** PASO 2 · Agrega ahora los que faltan en la BD. */
function sincronizarAhora() { sync_(false); }

/** La que ejecuta el activador diario. */
function sincronizacionDiaria() { sync_(false); }

/** PASO 3 · Activa la revisión diaria (ejecútala UNA sola vez). */
function activarSincronizacionDiaria() {
  desactivarSincronizacionDiaria();
  ScriptApp.newTrigger('sincronizacionDiaria').timeBased().everyDays(1).atHour(CONFIG.TRIGGER_HOUR).create();
  toast_('Revisión diaria activada: todos los días alrededor de las ' + CONFIG.TRIGGER_HOUR + ':00.');
}

function desactivarSincronizacionDiaria() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'sincronizacionDiaria')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/**
 * Guarda el usuario de la API (ejecútala UNA vez). Cambia los dos valores, ejecútala y luego
 * vuelve a dejarlos vacíos: quedan guardados en las "Propiedades del script", no en el código.
 * El usuario necesita rol admin o supervisor en REAB (es quien puede crear proveedores).
 */
function guardarCredenciales() {
  const EMAIL = '';      // ← correo del usuario de la API
  const PASSWORD = '';   // ← su contraseña
  if (!EMAIL || !PASSWORD) throw new Error('Escribe el correo y la contraseña dentro de la función antes de ejecutarla.');
  PropertiesService.getScriptProperties().setProperties({ API_EMAIL: EMAIL, API_PASSWORD: PASSWORD });
  toast_('Credenciales guardadas. Ya puedes dejar vacíos EMAIL y PASSWORD en el código.');
}

/** Menú opcional. Llámala desde tu onOpen existente (el del menú "OP · Automatizaciones"). */
function agregarMenuProveedores_() {
  SpreadsheetApp.getUi().createMenu('Proveedores → API')
    .addItem('1. Previsualizar los nuevos', 'previsualizarNuevos')
    .addItem('2. Agregar los nuevos ahora', 'sincronizarAhora')
    .addSeparator()
    .addItem('Activar revisión diaria', 'activarSincronizacionDiaria')
    .addItem('Desactivar revisión diaria', 'desactivarSincronizacionDiaria')
    .addToUi();
}

// ═══════════════════════════════════════════════════════════════════════════
// Lógica principal
// ═══════════════════════════════════════════════════════════════════════════

function sync_(dryRun) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { toast_('Ya hay una sincronización en curso.'); return; }
  const startedAt = new Date();
  const log = [];   // [fila, id, proveedor, resultado, detalle]

  try {
    const sheetRows = readSheet_(log);
    let token = login_();
    const existing = fetchAllSuppliers_(token);

    const names = new Set(existing.map(s => norm_(s.name)));
    const codes = new Map(existing.filter(s => s.code).map(s => [String(s.code).toUpperCase(), s.name]));

    // Los que faltan en la BD (y no están repetidos dentro de la propia hoja)
    const seen = new Set();
    const toAdd = [];
    sheetRows.forEach(r => {
      const key = norm_(r.payload.name);
      if (seen.has(key)) { log.push([r.row, r.payload.code || '', r.payload.name, 'OMITIDO', 'Repetido en la hoja (mismo nombre)']); return; }
      seen.add(key);
      if (names.has(key)) return;                                    // ya existe por nombre
      const code = (r.payload.code || '').toUpperCase();
      if (code && codes.has(code)) {                                 // el ID ya está usado
        log.push([r.row, code, r.payload.name, 'AVISO', 'El ID ya existe en la BD con otro nombre: "' + codes.get(code) + '". No se agregó.']);
        return;
      }
      toAdd.push(r);
    });

    let added = 0, failed = 0;
    if (dryRun) {
      toAdd.forEach(r => log.push([r.row, r.payload.code || '', r.payload.name, 'POR AGREGAR', '']));
    } else {
      // POST /suppliers/bulk: hasta 500 por petición y TODO O NADA (si una fila es inválida no se crea ninguna).
      for (let i = 0; i < toAdd.length; i += CONFIG.BULK_SIZE) {
        const chunk = toAdd.slice(i, i + CONFIG.BULK_SIZE);
        const body = { items: chunk.map(r => r.payload) };
        let res = post_(token, '/suppliers/bulk', body);
        if (res.status === 401) { token = login_(); res = post_(token, '/suppliers/bulk', body); }   // el token dura ~5 min
        if (res.status >= 200 && res.status < 300) {
          chunk.forEach(r => { added++; log.push([r.row, r.payload.code || '', r.payload.name, 'AGREGADO', '']); });
        } else if ([400, 404, 422].indexOf(res.status) >= 0) {
          // Nada se creó: o el endpoint masivo no existe aún (404) o hay alguna fila inválida. Se reintenta una a una
          // para aislar la que falla y agregar el resto.
          const out = addOneByOne_(token, chunk, log);
          token = out.token; added += out.added; failed += out.failed;
        } else {
          chunk.forEach(r => { failed++; log.push([r.row, r.payload.code || '', r.payload.name, 'ERROR ' + res.status, String(res.text).slice(0, 300)]); });
        }
      }
    }

    const resumen = dryRun
      ? toAdd.length + ' proveedor(es) por agregar (no se creó nada).'
      : added + ' agregado(s), ' + failed + ' con error. Ya existían ' + (sheetRows.length - toAdd.length) + '.';
    writeLog_(dryRun ? 'PREVISUALIZACIÓN' : 'SINCRONIZACIÓN', startedAt, resumen, log);
    toast_(resumen);

    if (!dryRun && CONFIG.NOTIFY_EMAIL && (added > 0 || failed > 0)) {
      const lineas = log.filter(l => /AGREGADO|ERROR|AVISO/.test(l[3])).map(l => l[3] + ' · ' + l[2] + (l[4] ? ' · ' + l[4] : ''));
      MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Proveedores → API: ' + resumen, lineas.join('\n'));
    }
  } catch (err) {
    writeLog_('ERROR', startedAt, String(err.message || err), log);
    if (CONFIG.NOTIFY_EMAIL) MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, 'Proveedores → API: ERROR', String(err.stack || err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/** Respaldo: crea los proveedores uno a uno con POST /suppliers y anota cada resultado. */
function addOneByOne_(token, rows, log) {
  let added = 0, failed = 0;
  rows.forEach(r => {
    let res = post_(token, '/suppliers', r.payload);
    if (res.status === 401) { token = login_(); res = post_(token, '/suppliers', r.payload); }
    if (res.status >= 200 && res.status < 300) {
      added++;
      log.push([r.row, r.payload.code || '', r.payload.name, 'AGREGADO', '']);
    } else {
      failed++;
      log.push([r.row, r.payload.code || '', r.payload.name, 'ERROR ' + res.status, String(res.text).slice(0, 300)]);
    }
    Utilities.sleep(CONFIG.PAUSE_MS);
  });
  return { token: token, added: added, failed: failed };
}

/** Lee la hoja y devuelve [{ row, payload }] listo para enviar a la API. */
function readSheet_(log) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error('No existe la hoja "' + CONFIG.SHEET_NAME + '".');
  const values = sh.getDataRange().getDisplayValues();   // lo que se VE en la celda (teléfonos, ceros a la izquierda…)
  const headers = values[CONFIG.HEADER_ROW - 1].map(norm_);

  const cols = {};                                        // índice de columna → campo de la API
  headers.forEach((h, i) => { if (COLUMN_MAP[h] && !Object.values(cols).includes(COLUMN_MAP[h])) cols[i] = COLUMN_MAP[h]; });
  if (!Object.values(cols).includes('name')) throw new Error('No encuentro la columna "Proveedor" en la fila ' + CONFIG.HEADER_ROW + '.');

  const out = [];
  for (let r = CONFIG.HEADER_ROW; r < values.length; r++) {
    const payload = {};
    Object.keys(cols).forEach(i => {
      const v = String(values[r][i]).trim();
      if (v && !/^-+$/.test(v)) payload[cols[i]] = v;      // vacío o "-" = sin dato
    });
    if (!payload.name) continue;                           // fila sin proveedor
    if (payload.code) payload.code = payload.code.toUpperCase();
    payload.default_currency = CONFIG.DEFAULT_CURRENCY;
    payload.default_exchange_rate = CONFIG.DEFAULT_EXCHANGE_RATE;
    out.push({ row: r + 1, payload: payload });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

function login_() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty('API_EMAIL'), password = props.getProperty('API_PASSWORD');
  if (!email || !password) throw new Error('Faltan las credenciales: ejecuta guardarCredenciales().');
  const res = UrlFetchApp.fetch(CONFIG.AUTH_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ email: email, password: password, rememberMe: false }),
  });
  if (res.getResponseCode() !== 200) throw new Error('No se pudo iniciar sesión (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
  const token = JSON.parse(res.getContentText()).token;
  if (!token) throw new Error('El servidor de autenticación no devolvió un token.');
  return token;
}

function request_(method, path, token, body) {
  const res = UrlFetchApp.fetch(CONFIG.API_BASE + path, {
    method: method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: body ? JSON.stringify(body) : undefined,
  });
  const text = res.getContentText();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* respuesta sin cuerpo */ }
  return { status: res.getResponseCode(), json: json, text: text };
}
function post_(token, path, body) { return request_('post', path, token, body); }

/** Todos los proveedores de la BD (id, código y nombre), página a página. */
function fetchAllSuppliers_(token) {
  const all = [], PAGE = 200;
  for (let page = 1; page < 50; page++) {
    let res = request_('get', '/suppliers?page=' + page + '&pageSize=' + PAGE + '&fields=id,code,name', token);
    if (res.status === 400) res = request_('get', '/suppliers?page=' + page + '&pageSize=' + PAGE, token);   // por si no admite "fields"
    if (res.status !== 200) throw new Error('No se pudo leer /suppliers (' + res.status + '): ' + res.text.slice(0, 200));
    const data = (res.json && res.json.data) || [];
    data.forEach(s => all.push({ id: s.id, code: s.code, name: s.name }));
    const pg = res.json && res.json.pagination;
    if (!data.length || data.length < PAGE || (pg && pg.hasNextPage === false)) break;
  }
  return all;
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════════════════════════════════════

/** "  Compañía  S.A. " → "compania s a"  (para comparar nombres sin tildes, mayúsculas ni signos) */
function norm_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function writeLog_(modo, startedAt, resumen, rows) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CONFIG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.LOG_SHEET);
    sh.appendRow(['Fecha', 'Modo', 'Fila hoja', 'ID', 'Proveedor', 'Resultado', 'Detalle']);
    sh.setFrozenRows(1);
  }
  const fecha = Utilities.formatDate(startedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  const lines = [[fecha, modo, '', '', '', 'RESUMEN', resumen]]
    .concat(rows.map(r => [fecha, modo, r[0], r[1], r[2], r[3], r[4]]));
  sh.getRange(sh.getLastRow() + 1, 1, lines.length, 7).setValues(lines);
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Proveedores → API', 8); } catch (e) { /* sin interfaz (activador) */ }
  console.log(msg);
}

/*
 * INSTALACIÓN (una sola vez)
 * ──────────────────────────
 * 1. En el Sheet: Extensiones → Apps Script. Si ya tiene código (el del menú "OP · Automatizaciones"),
 *    NO lo borres: crea un archivo nuevo (＋ → Script) llamado "SyncProveedores" y pega todo esto ahí.
 * 2. Usuario de la API: necesita rol admin o supervisor en REAB. Lo ideal es un usuario dedicado
 *    (por ejemplo sheets-bot@…) en lugar de una cuenta personal.
 * 3. Abre guardarCredenciales(), escribe el correo y la contraseña, ejecútala (te pedirá permisos la primera
 *    vez: acepta) y borra de nuevo esos dos textos del código.
 * 4. Ejecuta previsualizarNuevos(): en la hoja "Sync API" verás qué se agregaría (no crea nada). Revisa.
 * 5. Ejecuta sincronizarAhora(): agrega SOLO los que faltan.
 * 6. Ejecuta activarSincronizacionDiaria(): desde ese momento lo revisa todos los días.
 *
 * Opcional: pon tu correo en CONFIG.NOTIFY_EMAIL para recibir un aviso cuando se agregue algo o falle.
 */
