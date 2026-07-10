"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Dropdown } from "@/components/Dropdown";
import { PinInput } from "@/components/PinInput";
import { Button } from "@/components/Button";
import { AppFooter } from "@/components/AppFooter";
import styles from "./login.module.css";

const PIN_LENGTH = 4;

export default function LoginPage() {
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/roster")
      .then((res) => res.json())
      .then((data) => setNames(data.names ?? []))
      .catch(() => setRosterError("Could not load staff list"));
  }, []);

  async function submitLogin(pinValue: string) {
    if (!selectedName || pinValue.length < PIN_LENGTH) return;

    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedName, pin: pinValue }),
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

  function handleNameChange(name: string) {
    setSelectedName(name);
    setPin("");
    setError(null);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.main}>
        <header className={styles.header}>
          <Image
            src="/logo/Prime-Hotel-Logo.jpeg"
            alt="Prime Hotel"
            width={132}
            height={132}
            className={styles.logo}
            priority
          />
          <h1 className={styles.headline}>Welcome back</h1>
          <p className={styles.subline}>Prime Hotel Management System</p>
        </header>

        <div className={styles.content}>
          <div className={styles.card}>
            <Dropdown
              label="Who's on shift?"
              placeholder={rosterError ?? (names.length === 0 ? "Loading staff list…" : "Select your name")}
              options={names}
              value={selectedName}
              onChange={handleNameChange}
              disabled={names.length === 0}
            />

            {selectedName && (
              <div className={styles.pinSection}>
                <PinInput
                  length={PIN_LENGTH}
                  value={pin}
                  onChange={setPin}
                  onComplete={submitLogin}
                  error={error ?? undefined}
                  autoFocus
                />

                <Button
                  type="button"
                  variant="primary"
                  fullWidth
                  disabled={submitting || pin.length < PIN_LENGTH}
                  onClick={() => submitLogin(pin)}
                >
                  {submitting ? "Signing in…" : "Sign in"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <AppFooter />
    </div>
  );
}
