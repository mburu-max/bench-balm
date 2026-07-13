import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PagerState = {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  total: number;
  start: number;
  pageSize: number;
};

// Client-side pagination for a list already in memory (all our tables filter in the browser).
// Slices `items` to the current page and clamps the page when the list shrinks after filtering.
export function usePagination<T>(items: T[], pageSize = 10): PagerState & { pageItems: T[] } {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const clamped = Math.min(page, totalPages);
  const start = (clamped - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { page: clamped, setPage, pageItems, totalPages, total, start, pageSize };
}

// Footer bar for a table card: "Showing X–Y of Z" + prev/next. Renders nothing until there is
// more than one page, so short tables are unaffected. Spread the hook's return straight in:
//   const pg = usePagination(rows); … <Pager {...pg} />
export function Pager({ page, setPage, totalPages, total, start, pageSize }: PagerState) {
  if (total <= pageSize) return null;
  const from = start + 1;
  const to = Math.min(start + pageSize, total);
  return (
    <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums">Page {page} / {totalPages}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
