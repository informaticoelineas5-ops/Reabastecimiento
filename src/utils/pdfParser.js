import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerReady = false;
function ensureWorker() {
  if (workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerReady = true;
}

/**
 * Extrae todas las páginas de un PDF y devuelve un array 2D (filas × celdas).
 *
 * Estrategia:
 *  1. Agrupar items de texto con Y similar (tolerancia 3 pt) → mismo renglón
 *  2. Ordenar por X y fusionar items adyacentes (gap < 10 pt) → celdas
 *  3. Detectar la fila con más celdas como ancla de columnas
 *  4. Alinear filas con menos celdas por posición X → corrige columnas de imagen vacías
 *  5. Fusionar filas "escasas" (texto multi-línea de celda) en la fila de datos adyacente
 */
/**
 * Devuelve todos los items de texto del PDF con su posición (x, y).
 * Ordenados de arriba a abajo (Y desc) y de izquierda a derecha.
 * Útil para parsers específicos de proveedor que necesitan posición real.
 */
// Cada página se desplaza PAGE_GAP en Y para que la página 1 quede por encima de la 2, etc.
// Sin esto, los items de varias páginas se mezclan al ordenar por Y.
const PAGE_GAP = 10000;

export async function getRawTextItems(arrayBuffer) {
  ensureWorker();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const all = [];
  for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
    const page = await pdf.getPage(pNum);
    const { items } = await page.getTextContent();
    const offset = (pdf.numPages - pNum) * PAGE_GAP;
    for (const item of items) {
      const t = item.str?.trim();
      if (t) all.push({ t, x: item.transform[4], y: item.transform[5] + offset, p: pNum });
    }
  }
  all.sort((a, b) => b.y - a.y || a.x - b.x);
  return all;
}

export async function parsePdfToRows(arrayBuffer) {
  ensureWorker();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const allPositioned = [];   // [{text, x, right}[]]  — una entrada por fila

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items
      .filter(item => item.str?.trim())
      .map(item => ({
        text:  item.str,
        x:     item.transform[4],
        y:     item.transform[5],
        right: item.transform[4] + (item.width > 0 ? item.width : item.str.length * 5),
      }));

    if (!items.length) continue;

    // 1. Ordenar por Y descendente (origen PDF = esquina inferior-izquierda)
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // 2. Agrupar por Y con tolerancia 3 pt
    const Y_TOL = 3;
    const rowGroups = [];
    let group  = [items[0]];
    let groupY = items[0].y;

    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].y - groupY) <= Y_TOL) {
        group.push(items[i]);
      } else {
        rowGroups.push(group);
        group  = [items[i]];
        groupY = items[i].y;
      }
    }
    rowGroups.push(group);

    // 3. Por cada grupo: ordenar por X, fusionar items cercanos → celdas con posición
    for (const rowItems of rowGroups) {
      rowItems.sort((a, b) => a.x - b.x);
      const cells = [];
      let cur = { ...rowItems[0] };

      for (let i = 1; i < rowItems.length; i++) {
        const next = rowItems[i];
        const gap  = next.x - cur.right;
        if (gap <= 10) {
          cur.text  = cur.text + (gap > 1 ? ' ' : '') + next.text;
          cur.right = next.right;
        } else {
          cells.push({ text: cur.text.trim(), x: cur.x, right: cur.right });
          cur = { ...next };
        }
      }
      cells.push({ text: cur.text.trim(), x: cur.x, right: cur.right });

      const filtered = cells.filter(c =>
        c.text.length > 0 && !/^[&'"`~^]{1,4}$/.test(c.text)
      );
      if (filtered.length > 0) allPositioned.push(filtered);
    }
  }

  return alignAndMerge(allPositioned);
}

/* ─── Alineación por columnas + fusión de continuaciones ─────────────────── */

function alignAndMerge(posRows) {
  if (!posRows.length) return [];

  // Fila con más celdas = ancla de columnas (suele ser la cabecera)
  let anchorRow = posRows.reduce((best, r) => r.length > best.length ? r : best, posRows[0]);
  const maxCols = anchorRow.length;

  // Si todas las filas tienen el mismo número de celdas no hay columnas vacías
  const needsAlign = posRows.some(r => r.length < maxCols - 1);

  if (!needsAlign) {
    // Caso simple: solo aplanar y fusionar continuaciones
    const simple = posRows.map(r => r.map(c => c.text));
    return mergeRows(simple, maxCols);
  }

  // Anclas: punto medio X de cada columna en la fila ancla
  const anchors = anchorRow.map(c => (c.x + c.right) / 2);

  // Asignar cada celda a la columna más cercana por X
  const aligned = posRows.map(posRow => {
    if (posRow.length === maxCols) return posRow.map(c => c.text); // ya completa

    const row = new Array(maxCols).fill('');
    for (const cell of posRow) {
      const mid = (cell.x + cell.right) / 2;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < anchors.length; i++) {
        const d = Math.abs(mid - anchors[i]);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      row[best] = row[best] ? row[best] + ' ' + cell.text : cell.text;
    }
    return row;
  });

  return mergeRows(aligned, maxCols);
}

/**
 * Fusiona filas "escasas" (pocas celdas llenas = texto de línea extra en celda
 * multi-línea) con la fila de datos ANTERIOR, columna a columna.
 * Las filas escasas que aparecen ANTES de una fila de datos (cabeceras de
 * documento, logos, títulos) se descartan para no contaminar la fila de
 * encabezados de columna.
 */
function mergeRows(rows, maxCols) {
  const threshold = Math.max(1, Math.ceil(maxCols / 4));
  const nonEmpty  = r => r.filter(c => c && String(c).trim()).length;
  const isSparse  = r => nonEmpty(r) <= threshold;

  const absorb = (dst, src) => {
    for (let ci = 0; ci < src.length; ci++) {
      const t = src[ci] ? String(src[ci]).trim() : '';
      if (!t) continue;
      dst[ci] = dst[ci] ? dst[ci] + ' ' + t : t;
    }
  };

  const result = [];
  let i = 0;

  while (i < rows.length) {
    if (isSparse(rows[i])) {
      // Fila escasa sin fila de datos previa: descartar (cabecera de documento,
      // título, logo, línea decorativa).
      i++;
    } else {
      const data = [...rows[i]];
      // Absorber filas escasas SIGUIENTES (continuaciones de celda multi-línea)
      let j = i + 1;
      while (j < rows.length && isSparse(rows[j])) {
        absorb(data, rows[j]);
        j++;
      }
      result.push(data);
      i = j;
    }
  }

  return result;
}
