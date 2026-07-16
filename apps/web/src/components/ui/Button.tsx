import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-amber-700 text-white hover:bg-amber-600 disabled:bg-stone-400',
  secondary:
    'bg-stone-200 text-stone-900 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400',
  danger: 'bg-red-700 text-white hover:bg-red-600 disabled:bg-stone-400',
  ghost: 'bg-transparent text-stone-700 hover:bg-stone-200 disabled:text-stone-400',
};

export function Button({ variant = 'primary', className = '', type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...rest}
    />
  );
}
