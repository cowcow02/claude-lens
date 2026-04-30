"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CheckNowButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/updates/check", { method: "POST" });
      const data = (await res.json()) as {
        latestVersion?: string | null;
        updateAvailable?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setMessage(`Error: ${data.error ?? `${res.status}`}`);
      } else if (data.updateAvailable) {
        setMessage(`Update available: v${data.latestVersion}`);
      } else {
        setMessage(
          data.latestVersion
            ? `Up to date (latest on GHCR: v${data.latestVersion}).`
            : "Up to date.",
        );
      }
      router.refresh();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" disabled={busy} onClick={onClick}>
        {busy ? "Checking…" : "Check now"}
      </button>
      {message && (
        <p className="kicker" style={{ marginTop: 12 }}>
          {message}
        </p>
      )}
    </div>
  );
}
