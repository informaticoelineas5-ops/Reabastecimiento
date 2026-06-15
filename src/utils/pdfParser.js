import * as pdfjsLib from 'pdfjs-dist';
// Vite bundlea el worker como asset estático con ?url — sin dependencia de CDN
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let workerReady = false;

function ensureWorker() {
  if (workerReady) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  workerReady = true;
}

/**
 * Extrae todas las páginas de un PDF y devuelve un array 2D (filas × celdas),
 * igual que XLSX.utils.sheet_to_json(ws, { header: 1 }).
 *
 * Estrategia:
 *   1. Agrupar items de texto con Y similar (tolerancia 3 pt) → mismo renglón
 *   2. Ordenar items del renglón de izquierda a derecha (por X)
 *   3. Fusionar items adyacentes con gap horizontal < 5 pt → misma celda
 */
export async function parsePdfToRows(arrayBuffer) {
  ensureWorker();

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const allRows = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page    = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    // Mapear items a { text, x, y, right }
    const items = content.items
      .filter(item => item.str?.trim())
      .map(item => ({
        text:  item.str,
        x:     item.transform[4],
        y:     item.transform[5],
        right: item.transform[4] + (item.width > 0 ? item.width : item.str.length * 5),
      }));

    if (!items.length) continue;

    // Ordenar por Y descendente (origen PDF = esquina inferior-izquierda)
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    // Agrupar por Y con tolerancia 3 pt
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

    // Por cada grupo, ordenar por X y fusionar items de la misma celda
    for (const rowItems of rowGroups) {
      rowItems.sort((a, b) => a.x - b.x);

      const cells = [];
      let cur = { ...rowItems[0] };

      for (let i = 1; i < rowItems.length; i++) {
        const next = rowItems[i];
        const gap  = next.x - cur.right;

        if (gap <= 5) {
          // Misma celda: concatenar (añadir espacio si hay separación visible)
          cur.text  = cur.text + (gap > 1 ? ' ' : '') + next.text;
          cur.right = next.right;
        } else {
          cells.push(cur.text.trim());
          cur = { ...next };
        }
      }
      cells.push(cur.text.trim());

      const row = cells.filter(c => c.length > 0);
      if (row.length > 0) allRows.push(row);
    }
  }

  return allRows;
}
