"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Palette =
  | "iris"
  | "aurora"
  | "orchid"
  | "cobalt"
  | "sandstone"
  | "indigo"
  | "steel";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  palette: Palette;
  setTheme: (t: Theme) => void;
  setPalette: (p: Palette) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  palette: "iris",
  setTheme: () => {},
  setPalette: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export const PALETTE_META: Record<
  Palette,
  { label: string; color: string; glow: string }
> = {
  iris: { label: "Iris", color: "#7c5cff", glow: "0 0 7px #7c5cff" },
  aurora: { label: "Aurora", color: "#22d3ee", glow: "0 0 7px #22d3ee" },
  orchid: { label: "Orchid", color: "#cf5cf0", glow: "0 0 7px #cf5cf0" },
  cobalt: { label: "Cobalt", color: "#3b82f6", glow: "0 0 7px #3b82f6" },
  sandstone: { label: "Sandstone", color: "#14b8a6", glow: "0 0 7px #14b8a6" },
  indigo: { label: "Indigo", color: "#8b8bff", glow: "0 0 7px #8b8bff" },
  steel: { label: "Steel", color: "#67b8ff", glow: "0 0 7px #67b8ff" },
};

function applyTheme(theme: Theme, palette: Palette) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-palette", palette);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [palette, setPaletteState] = useState<Palette>("iris");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const savedTheme = (localStorage.getItem("gt-theme") as Theme) ?? "dark";
    const savedPalette = (localStorage.getItem("gt-palette") as Palette) ?? "iris";
    setThemeState(savedTheme);
    setPaletteState(savedPalette);
    applyTheme(savedTheme, savedPalette);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme, palette);
    localStorage.setItem("gt-theme", theme);
    localStorage.setItem("gt-palette", palette);
  }, [theme, palette, mounted]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  function setPalette(p: Palette) {
    setPaletteState(p);
  }

  function toggleTheme() {
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }

  if (!mounted) {
    return (
      <div
        data-theme="dark"
        data-palette="iris"
        style={{ minHeight: "100vh", background: "#0e0f13" }}
      />
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, palette, setTheme, setPalette, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
