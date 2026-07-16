import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 p-8 text-center">
      <p className="text-base font-semibold text-stone-700">{title}</p>
      {description !== undefined && (
        <p className="max-w-sm text-sm text-stone-500">{description}</p>
      )}
      {action}
    </div>
  );
}
