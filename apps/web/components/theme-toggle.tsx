"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "claude-lens:theme";
const COOKIE_NAME = "claude-lens-theme";

function readStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return null;
}

function systemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  // Set cookie so the server can read it on next navigation — this
  // is the FOUC-free alternative to inline <script> tags, which
  // Next.js 16 errors on regardless of strategy.
  try {
    document.cookie = `${COOKIE_NAME}=${theme};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
  } catch {
    // ignore
  }
}

/**
 * Theme toggle button.
 *
 * On first mount, reads the stored theme from localStorage (or falls
 * back to system preference), applies it to the DOM, and sets a
 * cookie so the next server render can pick it up.
 *
 * The server reads the cookie in layout.tsx and sets data-theme on
 * <html> during SSR — so after the first visit there's no FOUC.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") {
      setTheme(attr);
    } else {
      const resolved = readStoredTheme() ?? systemTheme();
      setTheme(resolved);
      applyTheme(resolved);
    }
    setHydrated(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 6,
        background: "transparent",
        border: "1px solid var(--af-border-subtle)",
        color: "var(--af-text-secondary)",
        cursor: "pointer",
        transition: "all 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--af-surface-hover)";
        e.currentTarget.style.color = "var(--af-text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--af-text-secondary)";
      }}
    >
      {!hydrated ? null : theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
