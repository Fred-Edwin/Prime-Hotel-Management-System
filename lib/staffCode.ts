const SYNTHETIC_EMAIL_DOMAIN = "prosper.internal";

/**
 * Builds the synthetic Supabase Auth email for a staff_code. Supabase
 * Auth requires an email+password internally; the person never sees
 * this — the login UI only shows Name and a PIN. See
 * docs/01_DATA_MODEL.md's "Auth note". No server-only dependencies,
 * so this stays unit-testable without a Next.js server runtime.
 */
export function staffCodeToSyntheticEmail(staffCode: string): string {
  return `user-${staffCode}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Generates the next sequential 2-digit staff_code (e.g. "01", "02",
 * ..."10", "11"...) given the codes already in use. Codes disambiguate
 * staff with the same first name internally — see docs/01_DATA_MODEL.md.
 */
export function nextStaffCode(existingCodes: string[]): string {
  const usedNumbers = existingCodes
    .map((code) => Number.parseInt(code, 10))
    .filter((n) => Number.isInteger(n) && n > 0);

  const next = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
  return next.toString().padStart(2, "0");
}
