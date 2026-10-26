'use client';
import { Button } from '@kejasha/ui/components/button';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import { errorMessage } from '@/lib/hooks';

/**
 * What a detail page shows before its data: a skeleton while loading, or the API's message with
 * a retry when the request failed (a skeleton alone would spin forever on an error).
 */
export function QueryFallback({
  query,
  className = 'h-64',
}: {
  query: { error: unknown; refetch: () => unknown; isFetching: boolean };
  className?: string;
}) {
  if (!query.error) return <Skeleton className={className} />;
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <p className="text-sm text-destructive">{errorMessage(query.error)}</p>
      <Button
        variant="outline"
        size="sm"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Try again
      </Button>
    </div>
  );
}
