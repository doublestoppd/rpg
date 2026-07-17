import { type InputHTMLAttributes, useId } from 'react';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
}

export function TextField({ label, error, className = '', ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-stone-700 dark:text-stone-300">
        {label}
      </label>
      <input
        id={id}
        className={`w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-700 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 ${error ? 'border-red-500' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
