import React, { useEffect, useState } from "react";

/** <img> que prueba `src` (la miniatura del servidor) y, si falla, `fallback` (la imagen original). `onFail` si ninguna carga. */
export default function SmartImg({ src, fallback, onFail, alt = "", ...props }) {
  const [useFallback, setUseFallback] = useState(false);
  useEffect(() => { setUseFallback(false); }, [src, fallback]);
  const cur = useFallback || !src ? fallback : src;
  if (!cur) return null;
  return (
    <img
      {...props}
      alt={alt}
      src={cur}
      onError={() => { if (!useFallback && src && fallback) setUseFallback(true); else onFail?.(); }}
    />
  );
}
