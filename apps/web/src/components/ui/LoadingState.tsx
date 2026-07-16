export interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Loading…' }: LoadingStateProps) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-stone-500" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-stone-300 border-t-amber-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
