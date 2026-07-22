import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

type ToastKind = 'info' | 'success' | 'error';

interface ToastOptions {
  /** Invoked when the toast body is clicked; the toast then dismisses. */
  onClick?: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  onClick?: () => void;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const kindClasses: Record<ToastKind, string> = {
  info: 'border-stone-300 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100',
  success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = 'info', options?: ToastOptions) => {
      const id = nextId.current++;
      const item: ToastItem = { id, kind, message };
      if (options?.onClick) item.onClick = options.onClick;
      setToasts((current) => [...current, item]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-md border px-4 py-2 text-sm shadow-md ${kindClasses[toast.kind]}`}
          >
            {toast.onClick ? (
              <button
                type="button"
                onClick={() => {
                  toast.onClick?.();
                  dismiss(toast.id);
                }}
                className="flex-1 cursor-pointer text-left"
              >
                {toast.message}
              </button>
            ) : (
              <span className="flex-1">{toast.message}</span>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="-mr-1 shrink-0 rounded p-0.5 text-current opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
