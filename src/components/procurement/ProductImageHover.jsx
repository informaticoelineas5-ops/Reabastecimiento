import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import SmartImg from "@/components/common/SmartImg";
import { productImageUrl } from "@/utils/productImage";

const POP_W = 232;
const POP_H = 268;
const GAP = 10;
const AUTO_MS = 1800;

function Carousel({ images, name, codigo, onEnter, onLeave, style }) {
  const [broken, setBroken] = useState(() => new Set());
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const list = useMemo(() => images.filter(u => !broken.has(u)), [images, broken]);
  const n = list.length;
  const cur = n ? list[Math.min(idx, n - 1)] : null;

  useEffect(() => {
    if (n < 2 || paused) return;
    const t = setInterval(() => setIdx(i => (i + 1) % n), AUTO_MS);
    return () => clearInterval(t);
  }, [n, paused]);

  const go = (d) => setIdx(i => (i + d + n) % n);

  return (
    <div
      style={style}
      onMouseEnter={() => { onEnter(); setPaused(true); }}
      onMouseLeave={() => { onLeave(); setPaused(false); }}
      className="fixed z-[100] rounded-xl border border-border bg-popover shadow-xl p-2 animate-in fade-in-0 zoom-in-95 duration-100"
    >
      <div className="relative bg-white rounded-lg overflow-hidden flex items-center justify-center" style={{ width: POP_W - 16, height: POP_W - 16 }}>
        {cur ? (
          <SmartImg
            key={cur}
            src={codigo && cur === images[0] ? productImageUrl(codigo, "md") : null}
            fallback={cur}
            alt={name}
            onFail={() => setBroken(prev => new Set(prev).add(cur))}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground text-xs">
            <ImageOff size={28} className="opacity-40" />
            Sin imagen disponible
          </div>
        )}
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Anterior"
              className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65">
              <ChevronLeft size={14} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Siguiente"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65">
              <ChevronRight size={14} />
            </button>
            <span className="absolute top-1.5 right-1.5 rounded-full bg-black/55 text-white text-[10px] px-1.5 py-0.5 tabular-nums">
              {Math.min(idx, n - 1) + 1}/{n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-1 mt-1.5">
          {list.map((u, i) => (
            <button key={u} type="button" onClick={() => setIdx(i)} aria-label={`Imagen ${i + 1}`}
              className={cn("h-1.5 rounded-full transition-all", i === Math.min(idx, n - 1) ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60")} />
          ))}
        </div>
      )}
      <p className="mt-1.5 text-[11px] leading-tight text-foreground/80 line-clamp-2 px-0.5" style={{ width: POP_W - 16 }}>{name}</p>
    </div>
  );
}

/**
 * Miniatura + nombre del producto. Al pasar el cursor por encima se abre un carrusel con todas
 * sus imágenes (avanza solo; se pausa al entrar en él; flechas y puntos para moverse a mano).
 */
export default function ProductImageHover({ name, images = [], codigo = null, className, subtitle = null, thumbOnly = false, thumbClass = "h-9 w-9", singleImage = false, children }) {
  const triggerRef = useRef(null);
  const openTimer  = useRef(null);
  const closeTimer = useRef(null);
  const [pos, setPos] = useState(null);
  const [thumbBroken, setThumbBroken] = useState(false);

  // singleImage: solo la imagen principal, sin carrusel al pasar el cursor (tablas largas: menos carga)
  const urls = useMemo(() => { const all = (images ?? []).filter(Boolean); return singleImage ? all.slice(0, 1) : all; }, [images, singleImage]);

  const open = useCallback(() => {
    clearTimeout(closeTimer.current);
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let left = r.right + GAP;
      if (left + POP_W > window.innerWidth - 8) left = Math.max(8, r.left - POP_W - GAP);
      const top = Math.min(Math.max(8, r.top + r.height / 2 - POP_H / 2), window.innerHeight - POP_H - 8);
      setPos({ left, top });
    }, 180);
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPos(null), 160);
  }, []);
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [pos]);
  useEffect(() => () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current); }, []);

  return (
    <div ref={triggerRef} onMouseEnter={singleImage ? undefined : open} onMouseLeave={singleImage ? undefined : scheduleClose} className={cn("flex items-center gap-2 min-w-0", className)}>
      <div className={cn("relative shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center border border-border/50", thumbClass)}>
        {urls.length && !thumbBroken ? (
          <SmartImg src={codigo ? productImageUrl(codigo, "sm") : null} fallback={urls[0]} onFail={() => setThumbBroken(true)} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <ImageOff size={14} className="text-muted-foreground/40" />
        )}
        {urls.length > 1 && !thumbBroken && (
          <span className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] leading-none px-1 py-0.5 rounded-tl">{urls.length}</span>
        )}
      </div>
      {!thumbOnly && (children ?? (
        <div className="min-w-0">
          <span className="block break-words font-medium leading-tight cursor-default">{name || "—"}</span>
          {subtitle}
        </div>
      ))}
      {pos && createPortal(
        <Carousel images={urls} name={name} codigo={codigo} onEnter={cancelClose} onLeave={scheduleClose} style={{ left: pos.left, top: pos.top, width: POP_W }} />,
        document.body,
      )}
    </div>
  );
}
