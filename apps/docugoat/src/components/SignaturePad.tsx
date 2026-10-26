import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import SignaturePadLib from "signature_pad";
import { Eraser } from "lucide-react";

export interface SignaturePadHandle { isEmpty(): boolean; toDataUrl(): string; clear(): void }

export const SignaturePad = forwardRef<SignaturePadHandle, { onDraw?: () => void }>(function SignaturePad({ onDraw }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pad = new SignaturePadLib(canvas, { penColor: "#f4f3ee", minWidth: 0.9, maxWidth: 2.4, throttle: 8 });
    padRef.current = pad;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const data = pad.toData();
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      pad.fromData(data);
    };
    resize();
    pad.addEventListener("endStroke", () => onDraw?.());
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); pad.off(); };
  }, [onDraw]);

  useImperativeHandle(ref, () => ({
    isEmpty: () => padRef.current?.isEmpty() ?? true,
    clear: () => padRef.current?.clear(),
    // Export on white so the PNG reads correctly on paper.
    toDataUrl: () => {
      const pad = padRef.current!;
      const src = canvasRef.current!;
      const out = document.createElement("canvas");
      out.width = src.width; out.height = src.height;
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
      const tmp = new SignaturePadLib(out, { penColor: "#111", minWidth: 0.9 * (src.width / src.offsetWidth), maxWidth: 2.4 * (src.width / src.offsetWidth) });
      const scale = src.width / src.offsetWidth;
      tmp.fromData(pad.toData().map((s) => ({ ...s, points: s.points.map((p) => ({ ...p, x: p.x * scale, y: p.y * scale })) })));
      return out.toDataURL("image/png");
    },
  }));

  return (
    <div className="relative">
      <canvas ref={canvasRef} className="h-44 w-full cursor-crosshair rounded-xl border border-dashed border-bone-500/40 bg-ink-900 touch-none" />
      <div className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-bone-500/30" />
      <span className="pointer-events-none absolute bottom-3 left-6 text-[11px] text-bone-500">Sign above the line</span>
      <button type="button" className="btn-ghost btn-sm absolute right-2 top-2" onClick={() => padRef.current?.clear()}><Eraser size={13} /> Clear</button>
    </div>
  );
});
