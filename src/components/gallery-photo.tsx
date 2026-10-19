'use client';
import { useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { GalleryGesture } from '../lib/gallery-gesture';
import { VehicleImage } from './common';
import { useLocale } from './providers';
import { Button } from './ui/button';

// Mounted with the photo URL as key: changing photos resets zoom and gestures.
export function GalleryPhoto({
  src,
  alt,
  onNavigate,
}: {
  src: string;
  alt: string;
  onNavigate: (direction: number) => void;
}) {
  const { t } = useLocale();
  const gesture = useRef(new GalleryGesture());
  const [view, setView] = useState(gesture.current.snapshot());
  return (
    <>
      <div className="flex justify-center">
        <div
          className="gallery-touch-photo"
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            const rect = event.currentTarget.getBoundingClientRect();
            gesture.current.width = rect.width;
            gesture.current.height = rect.height;
            event.currentTarget.setPointerCapture(event.pointerId);
            gesture.current.down(event.pointerId, { x: event.clientX, y: event.clientY });
          }}
          onPointerMove={(event) =>
            setView(gesture.current.move(event.pointerId, { x: event.clientX, y: event.clientY }))
          }
          onPointerUp={(event) => {
            const direction = gesture.current.up(event.pointerId, {
              x: event.clientX,
              y: event.clientY,
            });
            if (direction) onNavigate(direction);
          }}
          onPointerCancel={(event) => {
            gesture.current.up(event.pointerId, { x: event.clientX, y: event.clientY }, true);
          }}
          onLostPointerCapture={(event) => {
            gesture.current.up(event.pointerId, { x: event.clientX, y: event.clientY }, true);
          }}
          onDoubleClick={() => setView(gesture.current.zoom(view.scale > 1 ? 1 : 2))}
        >
          <VehicleImage
            src={src}
            alt={alt}
            draggable={false}
            className="block w-auto h-auto max-w-full max-h-[calc(98dvh-250px)] select-none"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          />
        </div>
      </div>
      <div className="flex justify-center items-center gap-2 mt-2">
        <Button
          variant="outline"
          aria-label={t('galleryZoomOut')}
          disabled={view.scale <= 1}
          onClick={() => setView(gesture.current.zoom(view.scale - 0.5))}
        >
          <Minus size={16} />
        </Button>
        <span className="text-sm tabular-nums" aria-live="polite">
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          variant="outline"
          aria-label={t('galleryZoomIn')}
          disabled={view.scale >= 4}
          onClick={() => setView(gesture.current.zoom(view.scale + 0.5))}
        >
          <Plus size={16} />
        </Button>
        <Button
          variant="outline"
          aria-label={t('galleryZoomReset')}
          disabled={view.scale === 1}
          onClick={() => setView(gesture.current.zoom(1))}
        >
          <RotateCcw size={16} />
        </Button>
      </div>
      <p className="text-xs text-center text-slate-500 mt-2">{t('galleryGestures')}</p>
    </>
  );
}
