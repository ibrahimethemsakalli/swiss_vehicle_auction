'use client';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useLocale } from '../providers';
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({
  children,
  wide = false,
  lightbox = false,
  onKeyDown,
  className = '',
}: {
  children: React.ReactNode;
  wide?: boolean;
  lightbox?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  className?: string;
}) {
  const { t } = useLocale();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm" />
      <DialogPrimitive.Content
        onKeyDown={onKeyDown}
        className={`fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl ${lightbox ? 'w-[98vw] max-w-[1600px] max-h-[98dvh] p-3 sm:p-4' : `max-h-[90dvh] w-[calc(100%_-_2rem)] p-6 ${wide ? 'max-w-4xl' : 'max-w-lg'}`} ${className}`}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={t('close')}
          className="absolute right-3 top-3 rounded-full bg-white p-2 text-slate-500 hover:bg-slate-100"
        >
          <X size={18} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
