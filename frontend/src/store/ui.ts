import { create } from "zustand";
import i18n from "../lib/i18n";
import type { Theme } from "../lib/theme";

type Lang = "zh" | "en";

const printMode = window.location.hash.startsWith("#/briefing");
const queryTheme = new URLSearchParams(window.location.search).get("theme") as Theme | null;
const initialTheme: Theme = printMode ? "light" : queryTheme || (localStorage.getItem("bl.theme") as Theme) || "dark";
const initialLang: Lang =
  (new URLSearchParams(window.location.search).get("lang") as Lang) ||
  (localStorage.getItem("bl.lang") as Lang) ||
  "zh";
const initialCb = localStorage.getItem("bl.cb") === "1";

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("bl.theme", theme);
}

export function applyColorblind(on: boolean) {
  document.documentElement.dataset.cb = on ? "1" : "0";
  localStorage.setItem("bl.cb", on ? "1" : "0");
}

applyTheme(initialTheme);
applyColorblind(initialCb);

interface UIState {
  theme: Theme;
  lang: Lang;
  colorblind: boolean;
  toggleTheme: () => void;
  toggleColorblind: () => void;
  setLang: (l: Lang) => void;
}

export const useUI = create<UIState>((set, get) => ({
  theme: initialTheme,
  lang: initialLang,
  colorblind: initialCb,
  toggleTheme: () => {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    applyTheme(next);
    set({ theme: next });
  },
  toggleColorblind: () => {
    const next = !get().colorblind;
    applyColorblind(next);
    set({ colorblind: next });
  },
  setLang: (l) => {
    i18n.changeLanguage(l);
    localStorage.setItem("bl.lang", l);
    set({ lang: l });
  },
}));
