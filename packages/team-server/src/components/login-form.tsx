"use client";

import { useState } from "react";

export function LoginForm({ allowSignup }: { allowSignup: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: res.statusText }));
        setError(data.error || "Sign-in failed");
        return;
      }
      const data = await res.json();
      window.location.href = data.landingSlug ? `/team/${data.landingSlug}` : "/";
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="form-card login">
      <h1>Sign <em>in</em></h1>
      <p className="lede">Welcome back.</p>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@acme.com"
          />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <button type="submit" disabled={loading} className="btn" style={{ width: "100%" }}>
          {loading ? "Signing in…" : "Sign in →"}
        </button>
      </form>
      {allowSignup && (
        <div className="form-alt">
          New here? <a href="/signup">Create an account</a>
        </div>
      )}
    </div>
  );
}
