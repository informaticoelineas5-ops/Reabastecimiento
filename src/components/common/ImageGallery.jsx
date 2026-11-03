import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import SmartImg from "@/components/common/SmartImg";
import { productImageUrl } from "@/utils/productImage";

/** Galería de imágenes de un producto: imagen principal grande, flechas y miniaturas. */
export default function ImageGallery({ images = [], name = "", codigo = null, className }) {
  const [broken, setBroken] = useState(() => new Set());
  const [idx, setIdx] = useState(0);
  const list = useMemo(() => images.filter(u => u && !broken.has(u)), [images, broken]);
  const n = list.length;
  const cur = n ? list[Math.min(idx, n - 1)] : null;
  const go = (d) => setIdx(i => (i + d + n) % n);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative aspect-square max-h-64 w-full rounded-lg border border-border bg-white flex items-center justify-center overflow-hidden">
        {cur ? (
          <SmartImg key={cur} src={codigo && cur === images[0] ? productImageUrl(codigo, "md") : null} fallback={cur} alt={name} onFail={() => setBroken(prev => new Set(prev).add(cur))} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground text-xs">
            <ImageOff size={32} className="opacity-40" />
            Sin imagen disponible
          </div>
        )}
        {n > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Siguiente"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/45 text-white flex items-center justify-center hover:bg-black/65">
              <ChevronRight size={16} />
            </button>
            <span className="absolute top-2 right-2 rounded-full bg-black/55 text-white text-[10px] px-2 py-0.5 tabular-nums">
              {Math.min(idx, n - 1) + 1}/{n}
            </span>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {list.map((u, i) => (
            <button key={u} type="button" onClick={() => setIdx(i)}
              className={cn("h-12 w-12 shrink-0 rounded-md border overflow-hidden bg-white", i === Math.min(idx, n - 1) ? "border-primary ring-1 ring-primary" : "border-border opacity-70 hover:opacity-100")}>
              <SmartImg src={codigo && u === images[0] ? productImageUrl(codigo, "sm") : null} fallback={u} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
