import React, { useRef, useState, useImperativeHandle, forwardRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Eraser } from 'lucide-react';
import { cn } from './Layout';

export interface SignaturePadRef {
  isEmpty: () => boolean;
  clear: () => void;
  getSignatureDataUrl: () => string;
}

interface SignaturePadProps {
  onBegin?: () => void;
  onEnd?: () => void;
  error?: boolean;
}

export const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ onBegin, onEnd, error }, ref) => {
    const padRef = useRef<SignatureCanvas>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      isEmpty: () => {
        return padRef.current?.isEmpty() ?? true;
      },
      clear: () => {
        padRef.current?.clear();
        onEnd?.(); // Trigger validation update
      },
      getSignatureDataUrl: () => {
        if (padRef.current?.isEmpty()) return '';
        // Create a white background canvas to avoid transparent PDFs
        const canvas = padRef.current?.getCanvas(); // Use getCanvas() instead of getTrimmedCanvas() to avoid ESM issues with trim-canvas
        if (!canvas) return '';
        
        // Persist a bounded image instead of the full device-pixel-ratio canvas.
        // High-DPI phones can otherwise create unnecessarily large PNGs and
        // make delivery saves/PDF generation consume far more memory than needed.
        const maxOutputWidth = 900;
        const scale = Math.min(1, maxOutputWidth / canvas.width);
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = Math.max(1, Math.round(canvas.width * scale));
        bgCanvas.height = Math.max(1, Math.round(canvas.height * scale));
        const ctx = bgCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
          ctx.drawImage(canvas, 0, 0, bgCanvas.width, bgCanvas.height);
        }
        return bgCanvas.toDataURL('image/png');
      },
    }));

    // Resize canvas on window resize to ensure correct coordinate mapping
    useEffect(() => {
      const handleResize = () => {
        if (wrapperRef.current && padRef.current) {
          const existingSignature = padRef.current.toData();
          const canvas = padRef.current.getCanvas();
          const ratio = Math.max(window.devicePixelRatio || 1, 1);
          canvas.width = wrapperRef.current.offsetWidth * ratio;
          canvas.height = wrapperRef.current.offsetHeight * ratio;
          canvas.getContext('2d')?.scale(ratio, ratio);
          padRef.current.clear();
          if (existingSignature.length > 0) padRef.current.fromData(existingSignature);
        }
      };

      // Slight delay to ensure DOM is fully painted
      const initialResize = window.setTimeout(handleResize, 100);
      window.addEventListener('resize', handleResize);
      return () => {
        window.clearTimeout(initialResize);
        window.removeEventListener('resize', handleResize);
      };
    }, []);

    return (
      <div className="flex flex-col gap-2">
        <div 
          ref={wrapperRef}
          className={cn(
            "relative w-full h-48 bg-slate-50 border rounded-lg overflow-hidden touch-none",
            error ? "border-red-500 ring-1 ring-red-500" : "border-slate-300 focus-within:border-[#2bb2c8] focus-within:ring-1 focus-within:ring-[#2bb2c8]"
          )}
        >
          <SignatureCanvas
            ref={padRef}
            penColor="black"
            onBegin={onBegin}
            onEnd={onEnd}
            canvasProps={{
              className: 'absolute inset-0 w-full h-full cursor-crosshair'
            }}
          />
          <div className="absolute top-2 left-2 pointer-events-none">
            <span className="text-xs font-medium text-slate-400 select-none">Assine aqui</span>
          </div>
          <div className="absolute bottom-2 left-2 right-2 border-b border-dashed border-slate-300 pointer-events-none" />
        </div>
        
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              padRef.current?.clear();
              onEnd?.();
            }}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors px-2 py-1 rounded hover:bg-slate-100"
          >
            <Eraser className="w-3.5 h-3.5" />
            Limpar Assinatura
          </button>
        </div>
      </div>
    );
  }
);

SignaturePad.displayName = 'SignaturePad';
