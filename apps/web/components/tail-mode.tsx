"use client";

/**
 * "Tail mode" floating action button for live sessions.
 *
 * - Shows a "↓ Jump to latest" FAB when the user is NOT at the bottom
 * - Clicking it scrolls to the bottom and enables tail mode
 * - In tail mode: auto-scrolls to the bottom after every render
 *   (new events arrive via LiveRefresher → router.refresh() → RSC re-render)
 * - If the user manually scrolls up, tail mode disables
 * - Shows "Following live" indicator when tailing
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowDown, Radio } from "lucide-react";

export function TailMode({ isLive }: { isLive: boolean }) {
  const [tailing, setTailing] = useState(false);
  const [atBottom, setAtBottom] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const userScrolledRef = useRef(false);

  // Find the <main> scroll container once.
  useEffect(() => {
    mainRef.current = document.querySelector("main");
  }, []);

  // Track whether we're at the bottom.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const check = () => {
      const threshold = 80; // px from bottom to count as "at bottom"
      const isAtBottom =
        main.scrollHeight - main.scrollTop - main.clientHeight < threshold;
      setAtBottom(isAtBottom);

      // If user scrolled up while tailing, disable tail mode.
      if (tailing && !isAtBottom && userScrolledRef.current) {
        setTailing(false);
      }
      userScrolledRef.current = true;
    };

    check();
    main.addEventListener("scroll", check, { passive: true });
    return () => main.removeEventListener("scroll", check);
  }, [tailing]);

  // Auto-scroll when tailing: after every render, jump to bottom.
  // The LiveRefresher triggers router.refresh() which re-renders the page
  // with new events — this effect catches those re-renders.
  useEffect(() => {
    if (!tailing) return;
    const main = mainRef.current;
    if (!main) return;

    // Use a MutationObserver to detect when new content is added
    // (the RSC re-render appends new transcript rows to the DOM).
    const observer = new MutationObserver(() => {
      userScrolledRef.current = false; // suppress the scroll-up detection
      main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
    });

    observer.observe(main, { childList: true, subtree: true });

    // Also scroll immediately when tail mode is first enabled.
    userScrolledRef.current = false;
    main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });

    return () => observer.disconnect();
  }, [tailing]);

  const jumpToLatest = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    userScrolledRef.current = false;
    main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
    setTailing(true);
  }, []);

  const stopTailing = useCallback(() => {
    setTailing(false);
  }, []);

  // Don't show anything if the session isn't live.
  if (!isLive) return null;

  return (
    <>
      {/* Tailing indicator bar */}
      {tailing && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 18px",
            background: "var(--af-surface-elevated)",
            border: "1px solid var(--af-accent)",
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 500,
            color: "var(--af-accent)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            cursor: "pointer",
          }}
          onClick={stopTailing}
          title="Click to stop following"
        >
          <Radio
            size={13}
            style={{ animation: "cs-live-pulse 1.6s ease-in-out infinite" }}
          />
          Following live
          <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", marginLeft: 4 }}>
            click to stop
          </span>
          <style>{`
            @keyframes cs-live-pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
          `}</style>
        </div>
      )}

      {/* Jump to latest FAB — shown when NOT at bottom and NOT already tailing */}
      {!tailing && !atBottom && (
        <button
          type="button"
          onClick={jumpToLatest}
          style={{
            position: "fixed",
            bottom: 24,
            right: 32,
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 18px",
            background: "var(--af-accent)",
            color: "#fff",
            border: "none",
            borderRadius: 100,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 4px 16px rgba(45, 212, 191, 0.3)",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow = "0 6px 24px rgba(45, 212, 191, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 16px rgba(45, 212, 191, 0.3)";
          }}
        >
          <ArrowDown size={14} />
          Jump to latest
        </button>
      )}
    </>
  );
}
