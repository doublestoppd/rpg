import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
}

export function Card({ title, actions, children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-stone-200 bg-white p-4 shadow-sm ${className}`}
      {...rest}
    >
      {(title !== undefined || actions !== undefined) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title !== undefined && (
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
