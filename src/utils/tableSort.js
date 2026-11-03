/**
 * Orden de tablas por clic en el encabezado.
 * Estado: { key, dir }  (key null = orden original de la pantalla)
 * Ciclo: columnas numéricas → mayor→menor, menor→mayor, sin orden · texto → A→Z, Z→A, sin orden.
 */
export function nextSort(prev, key, numeric) {
  if (prev.key !== key) return { key, dir: numeric ? "desc" : "asc" };
  const first = numeric ? "desc" : "asc";
  return prev.dir === first ? { key, dir: first === "asc" ? "desc" : "asc" } : { key: null, dir: "asc" };
}

/** Ordena una copia de `rows` por la columna activa; los vacíos van siempre al final. */
export function sortRows(rows, sort, getValue) {
  if (!sort?.key) return rows;
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = getValue(a, sort.key), y = getValue(b, sort.key);
    const xe = x == null || x === "", ye = y == null || y === "";
    if (xe && ye) return 0;
    if (xe) return 1;
    if (ye) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * mul;
    return String(x).localeCompare(String(y), "es", { numeric: true }) * mul;
  });
}
