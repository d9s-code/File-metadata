export type ModesView = "table" | "cards";

export function ModesViewToggle({ view, onChange }: { view: ModesView; onChange: (view: ModesView) => void }) {
  return (
    <div className="theme-toggle" role="group" aria-label="Modes view">
      <button
        type="button"
        aria-pressed={view === "table"}
        className={view === "table" ? "active" : ""}
        onClick={() => onChange("table")}
      >
        Table
      </button>
      <button
        type="button"
        aria-pressed={view === "cards"}
        className={view === "cards" ? "active" : ""}
        onClick={() => onChange("cards")}
      >
        Cards
      </button>
    </div>
  );
}
