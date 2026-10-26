'use client';
import { Button } from '@kejasha/ui/components/button';
import { Skeleton } from '@kejasha/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kejasha/ui/components/table';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/hooks';

/** Sorting over the loaded rows; filtering and paging are the API's job (cursor lists). */
export const tableFeats = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
  columnMeta: {} as { align?: 'right'; className?: string; hideOnMobile?: boolean },
});
export type Feats = typeof tableFeats;
export const columnsFor = <T extends RowData>() => createColumnHelper<Feats, T>();

export interface DataTableProps<T extends RowData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<Feats, T, any>[];
  data: T[];
  isPending?: boolean;
  empty?: ReactNode;
  /** Makes rows open a detail page. */
  rowHref?: (row: T) => string;
  hasMore?: boolean;
  loadMore?: () => void;
  loadingMore?: boolean;
  /** A failed load shows its message instead of the empty state. */
  error?: unknown;
}

export function DataTable<T extends RowData>({
  columns,
  data,
  isPending,
  empty = 'Nothing here yet.',
  rowHref,
  hasMore,
  loadMore,
  loadingMore,
  error,
}: DataTableProps<T>) {
  const router = useRouter();
  const table = useTable({ features: tableFeats, columns, data });
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => {
                  const sorted = h.column.getIsSorted();
                  const meta = h.column.columnDef.meta;
                  return (
                    <TableHead
                      key={h.id}
                      className={[
                        meta?.align === 'right' ? 'text-right' : '',
                        meta?.hideOnMobile ? 'hidden md:table-cell' : '',
                      ].join(' ')}
                    >
                      {h.isPlaceholder ? null : h.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          <table.FlexRender header={h} />
                          {sorted === 'asc' && <ArrowUp className="size-3" />}
                          {sorted === 'desc' && <ArrowDown className="size-3" />}
                        </button>
                      ) : (
                        <table.FlexRender header={h} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-destructive">
                  {errorMessage(error)}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => {
                const href = rowHref?.(row.original);
                return (
                  <TableRow
                    key={row.id}
                    className={href ? 'cursor-pointer' : undefined}
                    onClick={
                      href
                        ? (e) => {
                            // Links and buttons inside the row keep their own behaviour.
                            if ((e.target as HTMLElement).closest('a,button')) return;
                            router.push(href);
                          }
                        : undefined
                    }
                  >
                    {row.getAllCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell
                          key={cell.id}
                          className={[
                            meta?.align === 'right' ? 'text-right tabular-nums' : '',
                            meta?.hideOnMobile ? 'hidden md:table-cell' : '',
                            meta?.className ?? '',
                          ].join(' ')}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {hasMore && (
        <Button variant="outline" className="self-center" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
