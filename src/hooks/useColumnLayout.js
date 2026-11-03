import { useCallback, useEffect, useRef, useState } from "react";
import { listSavedViews, saveSavedView } from "@/api/savedViewsStore";

/** Ajusta un orden/ocultas guardados a las columnas que existen hoy (por si se añaden o quitan columnas). */
export function normalizeLayout(cfg, defaultOrder) {
  const saved = Array.isArray(cfg?.order) ? cfg.order.filter(id => defaultOrder.includes(id)) : [];
  const order = [...saved, ...defaultOrder.filter(id => !saved.includes(id))];
  const hidden = new Set((cfg?.hidden ?? []).filter(id => defaultOrder.includes(id)));
  if (hidden.size >= order.length) hidden.clear(); // nunca todas ocultas
  return { order, hidden };
}

/**
 * Orden y visibilidad de las columnas de una tabla, como preferencia personal del usuario.
 * Se guarda con el recurso de vistas guardadas (BD cuando el backend lo tenga; navegador mientras tanto),
 * en la pantalla `screen`, solo cuando el usuario cambia algo (0,8 s después del último cambio).
 * `defaultOrder` debe ser una constante estable (ids de columna en su orden original).
 */
export function useColumnLayout(screen, userKey, defaultOrder) {
  const [order, setOrder]   = useState(defaultOrder);
  const [hidden, setHidden] = useState(() => new Set());
  const [dirty, setDirty]   = useState(false);
  const idRef = useRef(null);

  useEffect(() => {
    if (!userKey) return;
    let alive = true;
    listSavedViews(userKey, screen).then(list => {
      const v = list[0];
      if (!alive || !v) return;
      idRef.current = v.id;
      const n = normalizeLayout(v.config, defaultOrder);
      setOrder(n.order);
      setHidden(n.hidden);
    }).catch(() => { /* sin preferencia guardada: columnas por defecto */ });
    return () => { alive = false; };
  }, [userKey, screen, defaultOrder]);

  const change = useCallback((nextOrder, nextHidden) => {
    setOrder(nextOrder);
    setHidden(nextHidden);
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!dirty || !userKey) return;
    const t = setTimeout(async () => {
      try {
        const v = await saveSavedView(userKey, screen, {
          id: idRef.current ?? undefined, name: "Columnas", config: { order, hidden: [...hidden] },
        });
        idRef.current = v.id;
      } catch (err) {
        console.warn(`[${screen}] no se pudo guardar el orden de columnas:`, err.message);
      }
      setDirty(false);
    }, 800);
    return () => clearTimeout(t);
  }, [dirty, order, hidden, userKey, screen]);

  return { order, hidden, change };
}
