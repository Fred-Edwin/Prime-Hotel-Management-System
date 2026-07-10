import Image from "next/image";
import styles from "./Wordmark.module.css";

export interface WordmarkProps {
  onDark?: boolean;
  logoSrc?: string;
}

/**
 * Brand presence per 01_COMPONENTS.md §4.1/§4.12: wordmark in Manrope, no
 * illustrated lockup. No logo asset has been supplied yet (flagged in
 * docs/phases/phase1_context.md) — renders a text wordmark until
 * public/logo/wordmark.svg (or an equivalent path passed via logoSrc)
 * exists, at which point pass logoSrc to render the real mark image
 * alongside the same text, or swap this component's implementation.
 */
export function Wordmark({ onDark = false, logoSrc }: WordmarkProps) {
  return (
    <span className={[styles.wordmark, onDark ? styles.onDark : ""].filter(Boolean).join(" ")}>
      {logoSrc && (
        <Image src={logoSrc} alt="" width={28} height={28} className={styles.mark} priority />
      )}
      Prime Hotel
    </span>
  );
}
