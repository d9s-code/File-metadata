/**
 * Resizable columns for every `table.data-table` in the app: drag a header's
 * right edge to widen or narrow its column, double-click the edge to put it
 * back. Widths are remembered in this browser per page and column, and put
 * back whenever the table is shown again.
 *
 * One set of document listeners does it for all tables, so no table needs
 * changing to get it. A table can name itself with `data-resize-key` to
 * share its widths across pages (the same table on several pages).
 */

const EDGE_PX = 6;
const MIN_PX = 48;
const STORE_PREFIX = "col-widths:";

function headerOfEdge(e: MouseEvent): HTMLTableCellElement | null {
  const th = (e.target as Element | null)?.closest?.("th");
  if (!th || !(th instanceof HTMLTableCellElement) || !th.closest("table.data-table")) return null;
  const rect = th.getBoundingClientRect();
  return rect.right - e.clientX <= EDGE_PX && rect.right - e.clientX >= -2 ? th : null;
}

function tableKey(table: HTMLTableElement): string {
  if (table.dataset.resizeKey) return STORE_PREFIX + table.dataset.resizeKey;
  // The page, with ids taken out (every Emitter's test page shares widths),
  // and which table on the page it is.
  const page = location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id");
  const index = Array.from(document.querySelectorAll("table.data-table")).indexOf(table);
  return `${STORE_PREFIX}${page}#${index}`;
}

function columnName(th: HTMLTableCellElement): string {
  return (th.textContent ?? "").trim() || `col${th.cellIndex}`;
}

function load(key: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function store(key: string, widths: Record<string, number>) {
  try {
    if (Object.keys(widths).length) localStorage.setItem(key, JSON.stringify(widths));
    else localStorage.removeItem(key);
  } catch {
    // not kept, that's all
  }
}

function setWidth(th: HTMLTableCellElement, px: number | null) {
  th.style.width = px == null ? "" : `${px}px`;
  th.style.minWidth = px == null ? "" : `${px}px`;
  th.style.maxWidth = px == null ? "" : `${px}px`;
}

/** Put a table's remembered widths back (once per set of headers). */
function restore(table: HTMLTableElement) {
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
  const signature = headers.map(columnName).join("|");
  if (table.dataset.colsRestored === signature) return;
  table.dataset.colsRestored = signature;
  const widths = load(tableKey(table));
  let any = false;
  for (const th of headers) {
    const px = widths[columnName(th)];
    if (px) {
      setWidth(th, px);
      any = true;
    }
  }
  table.classList.toggle("cols-resized", any);
}

let installed = false;

export function installColumnResize() {
  if (installed) return;
  installed = true;

  document.addEventListener("mousemove", (e) => {
    if (document.body.classList.contains("col-resizing")) return;
    document.body.classList.toggle("col-resize-edge", !!headerOfEdge(e));
  });

  document.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      const th = headerOfEdge(e);
      if (!th) return;
      e.preventDefault();
      e.stopPropagation();
      const table = th.closest("table") as HTMLTableElement;
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;
      document.body.classList.add("col-resizing");
      table.classList.add("cols-resized");

      function onMove(ev: MouseEvent) {
        setWidth(th!, Math.max(MIN_PX, Math.round(startWidth + ev.clientX - startX)));
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("col-resizing");
        const key = tableKey(table);
        store(key, { ...load(key), [columnName(th!)]: Math.round(th!.getBoundingClientRect().width) });
        // The click that ends a drag isn't a click on the header (a sort).
        document.addEventListener("click", (c) => c.stopPropagation(), { capture: true, once: true });
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    true,
  );

  document.addEventListener(
    "dblclick",
    (e) => {
      const th = headerOfEdge(e);
      if (!th) return;
      e.preventDefault();
      e.stopPropagation();
      const table = th.closest("table") as HTMLTableElement;
      setWidth(th, null);
      const key = tableKey(table);
      const widths = load(key);
      delete widths[columnName(th)];
      store(key, widths);
      table.classList.toggle("cols-resized", Object.keys(widths).length > 0);
    },
    true,
  );

  // Tables come and go as pages render: put their widths back as they appear.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      document.querySelectorAll<HTMLTableElement>("table.data-table").forEach(restore);
    });
  }).observe(document.body, { childList: true, subtree: true });
}
