export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "__wc_theme";

function prefersDarkTheme(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) {
        return true;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(theme: ThemeMode): ThemeMode {
    if (typeof document === "undefined") {
        return theme;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.style.colorScheme = theme;

    if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }

    return theme;
}

export function initializeTheme(): ThemeMode {
    if (typeof window === "undefined") {
        return "dark";
    }

    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const theme: ThemeMode =
        storedTheme === "light" || storedTheme === "dark"
            ? storedTheme
            : prefersDarkTheme()
              ? "dark"
              : "light";

    return applyTheme(theme);
}

export function toggleTheme(currentTheme?: ThemeMode): ThemeMode {
    const current =
        currentTheme ??
        (typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
            ? "dark"
            : "light");

    return applyTheme(current === "dark" ? "light" : "dark");
}
