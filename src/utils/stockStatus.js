// Umbrales de cobertura (en días) que usan Alertas y su panel de detalle
export const STOCK_DEFICIT_DAYS = 15;
export const STOCK_EXCESO_DAYS  = 60;

/** Estado de stock de un producto según su existencia y su promedio diario de ventas. */
export function getEstadoStock(cantidad, prom) {
  if (cantidad === 0)              return "AGOTADO";
  if (!prom || prom === 0)         return "SIN_VENTAS";
  const dias = cantidad / prom;
  if (dias < STOCK_DEFICIT_DAYS)   return "DÉFICIT";
  if (dias <= STOCK_EXCESO_DAYS)   return "GARANTIZADO";
  return "EXCESO";
}
