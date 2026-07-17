import { type ReactNode, useEffect, useRef } from 'react';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Modal dialog built on the native <dialog> element. */
export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-full max-w-md rounded-lg border border-stone-200 bg-white p-0 shadow-xl backdrop:bg-stone-900/50 dark:border-stone-800 dark:bg-stone-900"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        >
          ✕
        </button>
      </div>
      <div className="px-4 py-3 text-sm text-stone-700 dark:text-stone-300">{children}</div>
      {footer !== undefined && (
        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">{footer}</div>
      )}
    </dialog>
  );
}
