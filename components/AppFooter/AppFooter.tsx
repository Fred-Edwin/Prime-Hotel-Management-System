import styles from "./AppFooter.module.css";

/**
 * Login-screen footer band per docs/design/01_COMPONENTS.md §4.17 — the
 * only other aubergine surface on that screen besides the plain page
 * background and the white card. Not yet used outside /login.
 */
export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.supportRow}>
        <a
          className={styles.supportLink}
          href="https://wa.me/254113176613"
          target="_blank"
          rel="noopener noreferrer"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H12a8.4 8.4 0 0 1-4-1L3 20l1.1-4.8A8.5 8.5 0 1 1 21 11.5Z" />
            <path d="M8.5 10.5c.4 2 2 3.6 4 4" />
          </svg>
          <span>0113 176 613</span>
        </a>
        <a className={styles.supportLink} href="mailto:lobster.technologies.africa@gmail.com">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <span>Contact support</span>
        </a>
      </div>
      <p className={styles.attribution}>
        Developed by{" "}
        <a href="https://lobstertechnologies.co.ke/" target="_blank" rel="noopener noreferrer">
          Lobster Technologies
        </a>
      </p>
    </footer>
  );
}
