"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type StaffTableUser = {
  id: string;
  email: string;
  display_name: string | null;
  is_staff: boolean;
  created_at: string;
};

export function StaffTable({
  users,
  currentUserId,
}: {
  users: StaffTableUser[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffCount = users.filter((u) => u.is_staff).length;

  async function onToggle(user: StaffTableUser) {
    setError(null);

    if (user.is_staff && user.id === currentUserId && staffCount <= 1) {
      setError("You are the only staff user. Promote someone else before revoking yourself.");
      return;
    }

    const endpoint = user.is_staff ? "/api/admin/staff/revoke" : "/api/admin/staff/grant";
    setBusyId(user.id);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {error && (
        <p
          className="kicker"
          style={{ color: "var(--danger)", marginBottom: 12 }}
          role="alert"
        >
          {error}
        </p>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--rule)" }}>
            <th style={{ padding: "10px 8px", fontWeight: 500 }}>Email</th>
            <th style={{ padding: "10px 8px", fontWeight: 500 }}>Name</th>
            <th style={{ padding: "10px 8px", fontWeight: 500 }}>Joined</th>
            <th style={{ padding: "10px 8px", fontWeight: 500 }}>Staff</th>
            <th style={{ padding: "10px 8px", fontWeight: 500 }}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isLastStaff = u.is_staff && staffCount <= 1;
            // Revoke disallowed: on self, or on the last-remaining staff.
            const revokeBlocked = u.is_staff && (isSelf || isLastStaff);
            const buttonDisabled = busyId === u.id || revokeBlocked;
            const buttonLabel = u.is_staff ? "Revoke" : "Promote";
            const hint = u.is_staff
              ? isSelf
                ? "Can't revoke yourself"
                : isLastStaff
                  ? "Last staff"
                  : null
              : null;
            return (
              <tr
                key={u.id}
                style={{ borderBottom: "1px solid var(--rule-soft)" }}
              >
                <td style={{ padding: "12px 8px" }}>
                  <span className="mono" style={{ fontSize: 13 }}>{u.email}</span>
                  {isSelf && (
                    <span className="kicker" style={{ marginLeft: 8 }}>(you)</span>
                  )}
                </td>
                <td style={{ padding: "12px 8px" }}>{u.display_name ?? "—"}</td>
                <td style={{ padding: "12px 8px", color: "var(--mute)" }}>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {u.created_at.slice(0, 10)}
                  </span>
                </td>
                <td style={{ padding: "12px 8px" }}>
                  {u.is_staff ? (
                    <span style={{ color: "var(--accent)" }}>Yes</span>
                  ) : (
                    <span style={{ color: "var(--mute)" }}>No</span>
                  )}
                </td>
                <td style={{ padding: "12px 8px", textAlign: "right" }}>
                  <button
                    className="btn"
                    style={{ padding: "4px 12px", fontSize: 12 }}
                    disabled={buttonDisabled}
                    onClick={() => onToggle(u)}
                    title={hint ?? undefined}
                  >
                    {busyId === u.id ? "…" : buttonLabel}
                  </button>
                  {hint && (
                    <span
                      className="kicker"
                      style={{ marginLeft: 8, fontSize: 10 }}
                    >
                      {hint}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
