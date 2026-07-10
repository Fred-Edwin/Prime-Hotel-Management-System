import { Wordmark } from "@/components/Wordmark";

/**
 * Placeholder root page — Phase 1 builds tokens and components only, no
 * screens (04_PHASE_PLAN.md). Real routing (redirect to /login or /entry
 * based on auth state) lands in Phase 2.
 */
export default function Home() {
  return <Wordmark />;
}
