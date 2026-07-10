"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/roster")
      .then((res) => res.json())
      .then((data) => setNames(data.names ?? []))
      .catch(() => setError("Could not load staff list"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedName) return;

    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedName, pin }),
    });

    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className={styles.page}>
      <div className={styles.wordmark}>
        <Wordmark />
      </div>

      <div className={styles.card}>
        {!selectedName ? (
          <div className={styles.nameList}>
            {names.length === 0 && !error && <p>Loading staff list…</p>}
            {names.map((name) => (
              <button
                key={name}
                type="button"
                className={styles.nameButton}
                onClick={() => setSelectedName(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => {
                setSelectedName(null);
                setPin("");
                setError(null);
              }}
            >
              ← Not {selectedName}?
            </button>

            <Input
              label="PIN"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              error={error ?? undefined}
            />

            <Button type="submit" variant="primary" fullWidth disabled={submitting || pin.length < 4}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}

        {error && !selectedName && <p className={styles.formError}>{error}</p>}
      </div>
    </div>
  );
}
