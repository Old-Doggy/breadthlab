import { create } from "zustand";
import i18n from "../lib/i18n";
import type { Theme } from "../lib/theme";

type Lang = "zh" | "en";

const printMode = window.location.hash.startsWith("#/briefing");
const initialTheme: Theme = printMode ? "light" : ((localStorage.getItem("bl.theme") as Theme) || "dark");
const initialLang: Lang = (localStorage.getItem("bl.lang") as Lang) || "zh";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("bl.theme", theme);
}

applyTheme(initialTheme);

interface UIState {
  theme: Theme;
  lang: Lang;
  toggleTheme: () => void;
  setLang: (l: Lang) => void;
}

export const useUI = create<UIState>((set, get) => ({
  theme: initialTheme,
  lang: initialLang,
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
  setLang: (l) => {
    i18n.changeLanguage(l);
    localStorage.setItem("bl.lang", l);
    set({ lang: l });
  },
}));
