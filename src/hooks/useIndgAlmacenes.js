import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchIndgForAlmacenes } from "@/api/indgApSubClient";

const EMPTY = { products: new Map(), salesMap: new Map(), apMap: new Map(), loading: false, finished: false, error: null };

/**
 * Productos, índices de ventas y estado de anuncio de unos almacenes con una sola carga (reporte indg_ap_sub).
 * La carga queda en la caché de React Query: Alertas, Reab Directo y Catálogo la comparten.
 * Devuelve datos parciales mientras llegan las páginas (`loading`) y `finished` al terminar.
 */
export function useIndgAlmacenes(almacenes, enabled = true) {
  const queryClient = useQueryClient();
  const key = [...(almacenes ?? [])].sort().join("\x00");
  const [state, setState] = useState(EMPTY);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => {
    queryClient.removeQueries({ queryKey: ["indg-almacenes", key] });
    setNonce(n => n + 1);
  }, [queryClient, key]);

  useEffect(() => {
    if (!enabled || !key) { setState(EMPTY); return; }
    const cacheKey = ["indg-almacenes", key];
    const cached = queryClient.getQueryData(cacheKey);
    if (cached) { setState({ ...cached, loading: false, finished: true, error: null }); return; }
    let cancelled = false;
    setState({ ...EMPTY, loading: true });
    fetchIndgForAlmacenes(key.split("\x00"), (partial) => {
      if (!cancelled) setState({ ...partial, loading: true, finished: false, error: null });
    }).then((final) => {
      if (cancelled) return;
      queryClient.setQueryData(cacheKey, final);
      setState({ ...final, loading: false, finished: true, error: null });
    }).catch((error) => {
      console.error("[indg_ap_sub]", error);
      if (!cancelled) setState(s => ({ ...s, loading: false, finished: true, error }));
    });
    return () => { cancelled = true; };
  }, [key, enabled, nonce]);

  return { ...state, reload };
}
