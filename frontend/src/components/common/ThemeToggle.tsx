import { useTheme, type Theme } from "../../theme/ThemeContext";

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "☀︎", title: "Light" },
  { value: "system", label: "◐", title: "Match system" },
  { value: "dark", label: "☾", title: "Dark" },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          aria-label={opt.title}
          aria-pressed={theme === opt.value}
          className={theme === opt.value ? "active" : ""}
          onClick={() => setTheme(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
