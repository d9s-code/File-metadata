import { useTheme, type Theme } from "../../theme/ThemeContext";
import { Icon, type IconName } from "./Icon";

const OPTIONS: { value: Theme; icon: IconName; title: string }[] = [
  { value: "light", icon: "sun", title: "Light" },
  { value: "system", icon: "system", title: "Match system" },
  { value: "dark", icon: "moon", title: "Dark" },
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
          <Icon name={opt.icon} />
        </button>
      ))}
    </div>
  );
}
