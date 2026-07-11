"use client";

import { useState } from "react";
import {
  Button,
  Input,
  Stepper,
  TillStrip,
  Card,
  MetricCard,
  RoleLocationBadge,
  PeriodToggle,
  LowStockIndicator,
  Modal,
  Toast,
  EmptyState,
  CategoryChips,
  Wordmark,
  PinInput,
  PinKeypad,
  Select,
  Dropdown,
} from "@/components";
import styles from "./style-guide.module.css";

const NAV_SECTIONS = [
  { id: "colors", label: "Color tokens" },
  { id: "type", label: "Typography" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs & Select" },
  { id: "dropdown", label: "Dropdown" },
  { id: "pin", label: "PIN entry (comparison)" },
  { id: "stepper", label: "Stepper" },
  { id: "tillstrip", label: "Till Strip" },
  { id: "cards", label: "Cards & Metrics" },
  { id: "badges", label: "Badges & Indicators" },
  { id: "toggle", label: "Period Toggle & Chips" },
  { id: "overlays", label: "Modal & Toast" },
  { id: "empty", label: "Empty State" },
  { id: "wordmark", label: "Wordmark" },
];

/**
 * Internal, code-based reference for docs/design/*.md — every component in
 * components/ rendered with real tokens, for visual QA and comparison
 * (e.g. PinInput vs. PinKeypad below). Not part of the product's own
 * navigation; not gated behind auth since it ships no business data.
 * Desktop-first layout (sidebar + wide content) since this is a dev-time
 * tool, unlike the rest of this mobile-first product.
 */
export default function StyleGuidePage() {
  const [stepperValue, setStepperValue] = useState(3);
  const [pinInputValue, setPinInputValue] = useState("");
  const [pinKeypadValue, setPinKeypadValue] = useState("");
  const [period, setPeriod] = useState("today");
  const [category, setCategory] = useState("beverages");
  const [modalOpen, setModalOpen] = useState(false);
  const [toastVisible, setToastVisible] = useState(false);
  const [dropdownValue, setDropdownValue] = useState("");
  const [selectValue, setSelectValue] = useState("");

  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <div>
          <h2 className={styles.sidebarHeading}>Design System</h2>
          <p className={styles.sidebarSubtitle}>Prime Hotel Management System</p>
        </div>
        <nav className={styles.nav}>
          {NAV_SECTIONS.map((section) => (
            <a key={section.id} className={styles.navLink} href={`#${section.id}`}>
              {section.label}
            </a>
          ))}
        </nav>
      </aside>

      <main className={styles.content}>
        <h1 className={styles.pageHeading}>Component Library</h1>
        <p className={styles.pageIntro}>
          Live reference for every component in <code>components/</code>, rendered with real
          tokens. See <code>docs/design/00_FOUNDATIONS.md</code> and{" "}
          <code>docs/design/01_COMPONENTS.md</code> for the full specs behind each of these.
        </p>

        <section id="colors" className={styles.section}>
          <h2 className={styles.sectionHeading}>Color tokens</h2>
          <p className={styles.sectionDescription}>
            Foundations §2.1 — brand, status, and neutral scale.
          </p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <div className={styles.swatchRow}>
              {[
                ["Brand primary", "var(--color-brand-primary)"],
                ["Brand accent (gold)", "var(--color-brand-accent)"],
                ["Surface page", "var(--color-surface-page)"],
                ["Surface sunken", "var(--color-surface-sunken)"],
                ["Success", "var(--color-status-success)"],
                ["Warning", "var(--color-status-warning)"],
                ["Error", "var(--color-status-error)"],
              ].map(([label, value]) => (
                <div className={styles.swatch} key={label}>
                  <div className={styles.swatchColor} style={{ background: value }} />
                  <span className={styles.swatchLabel}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="type" className={styles.section}>
          <h2 className={styles.sectionHeading}>Typography</h2>
          <p className={styles.sectionDescription}>
            Foundations §2.2 — Manrope (structural), Plex Sans (data), Fraunces (login headline
            only).
          </p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <div className={styles.typeSample}>
              <span className={styles.typeSampleLabel}>heading-xl · Manrope 700</span>
              <span style={{ fontFamily: "var(--font-family-structural)", fontSize: "var(--font-size-heading-xl)", fontWeight: 700 }}>
                Today&apos;s Sales
              </span>
            </div>
            <div className={styles.typeSample}>
              <span className={styles.typeSampleLabel}>body-lg · Plex Sans 400</span>
              <span style={{ fontFamily: "var(--font-family-data)", fontSize: "var(--font-size-body-lg)" }}>
                Chapati — KES 25.00 each
              </span>
            </div>
            <div className={styles.typeSample}>
              <span className={styles.typeSampleLabel}>figure-lg · Plex Sans 600, tabular</span>
              <span
                style={{
                  fontFamily: "var(--font-family-data)",
                  fontSize: "var(--font-size-figure-lg)",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--color-brand-primary)",
                }}
              >
                KES 12,480.00
              </span>
            </div>
            <div className={styles.typeSample}>
              <span className={styles.typeSampleLabel}>display-lg · Fraunces 600 (login only)</span>
              <span style={{ fontFamily: "var(--font-family-display)", fontSize: "var(--font-size-display-lg)", fontWeight: 600 }}>
                Welcome back
              </span>
            </div>
          </div>
        </section>

        <section id="buttons" className={styles.section}>
          <h2 className={styles.sectionHeading}>Buttons</h2>
          <p className={styles.sectionDescription}>Components §4.2.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <div className={styles.row}>
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
          </div>
        </section>

        <section id="inputs" className={styles.section}>
          <h2 className={styles.sectionHeading}>Inputs &amp; Select</h2>
          <p className={styles.sectionDescription}>
            Components §4.3 (Input) and the native-select variant kept for admin CRUD forms.
          </p>
          <div className={styles.grid}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Input — default</p>
              <Input label="Item name" placeholder="e.g. Chapati" />
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Input — error</p>
              <Input label="Buying price" defaultValue="-5" error="Must be 0 or greater" />
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Input — numeric</p>
              <Input label="Quantity" numeric defaultValue="120" />
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Select — native (§4.3)</p>
              <Select
                label="Category"
                placeholder="Choose a category"
                options={[
                  { value: "beverages", label: "Beverages" },
                  { value: "snacks", label: "Snacks" },
                  { value: "meals", label: "Meals" },
                ]}
                value={selectValue}
                onChange={(e) => setSelectValue(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section id="dropdown" className={styles.section}>
          <h2 className={styles.sectionHeading}>Dropdown (custom listbox)</h2>
          <p className={styles.sectionDescription}>
            Components §4.18 — replaces a native select where the open-list appearance needs to
            match the card (e.g. the login name picker).
          </p>
          <div className={styles.tile} style={{ maxWidth: 360 }}>
            <Dropdown
              label="Who's on shift?"
              placeholder="Select your name"
              options={["Anne Gitonga", "Janiffer Maina", "Mercy Wanjohi", "Sarah Makena", "WaPrecious"]}
              value={dropdownValue}
              onChange={setDropdownValue}
            />
          </div>
        </section>

        <section id="pin" className={styles.section}>
          <h2 className={styles.sectionHeading}>PIN entry — comparison</h2>
          <p className={styles.sectionDescription}>
            Two approaches tried for the login screen. §4.19 (PinKeypad) is the current pick;
            §4.16 (PinInput) is kept in the codebase, unused, as a still-valid alternative.
          </p>
          <div className={styles.grid}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>§4.16 — PinInput (boxed digits)</p>
              <PinInput length={4} value={pinInputValue} onChange={setPinInputValue} />
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>§4.19 — PinKeypad (on-screen numpad)</p>
              <PinKeypad length={4} value={pinKeypadValue} onChange={setPinKeypadValue} />
            </div>
          </div>
        </section>

        <section id="stepper" className={styles.section}>
          <h2 className={styles.sectionHeading}>Stepper</h2>
          <p className={styles.sectionDescription}>Components §4.4 — the core till/reconciliation control.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <Stepper value={stepperValue} onChange={setStepperValue} max={5} aria-label="Chapati quantity" />
          </div>
        </section>

        <section id="tillstrip" className={styles.section}>
          <h2 className={styles.sectionHeading}>Till Strip</h2>
          <p className={styles.sectionDescription}>Components §4.5 — sticky running-total bar.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1", padding: 0, overflow: "hidden" }}>
            <TillStrip itemCount={12} totalValueLabel="KES 3,240.00" onSave={() => {}} />
          </div>
        </section>

        <section id="cards" className={styles.section}>
          <h2 className={styles.sectionHeading}>Cards &amp; Metrics</h2>
          <p className={styles.sectionDescription}>Components §4.10.</p>
          <div className={styles.grid}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Card — content</p>
              <Card style={{ padding: "var(--space-4)" }}>Plain content card.</Card>
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>MetricCard — light</p>
              <MetricCard label="Net profit" value="KES 8,120" trend="up" trendLabel="+12% vs last week" />
            </div>
            <div className={[styles.tile, styles.darkSurface].join(" ")}>
              <p className={styles.tileLabel}>MetricCard — onDark (dashboard hero band)</p>
              <MetricCard label="Total sales" value="KES 24,900" onDark trend="up" trendLabel="+8%" />
            </div>
          </div>
        </section>

        <section id="badges" className={styles.section}>
          <h2 className={styles.sectionHeading}>Badges &amp; Indicators</h2>
          <p className={styles.sectionDescription}>Components §4.6, §4.9.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <div className={styles.row}>
              <RoleLocationBadge label="Restaurant" variant="location" />
              <RoleLocationBadge label="Admin · All locations" variant="admin" />
              <LowStockIndicator variant="pill" label="Low stock" />
              <LowStockIndicator variant="dot" label="Low stock" />
            </div>
          </div>
        </section>

        <section id="toggle" className={styles.section}>
          <h2 className={styles.sectionHeading}>Period Toggle &amp; Category Chips</h2>
          <p className={styles.sectionDescription}>Components §4.8 and the flagged CategoryChips placeholder.</p>
          <div className={styles.grid}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>PeriodToggle</p>
              <PeriodToggle
                options={[
                  { value: "today", label: "Today" },
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                ]}
                value={period}
                onChange={setPeriod}
              />
            </div>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>CategoryChips (flagged placeholder, no real spec)</p>
              <CategoryChips
                options={[
                  { value: "beverages", label: "Beverages" },
                  { value: "snacks", label: "Snacks" },
                  { value: "meals", label: "Meals" },
                ]}
                value={category}
                onChange={setCategory}
              />
            </div>
          </div>
        </section>

        <section id="overlays" className={styles.section}>
          <h2 className={styles.sectionHeading}>Modal &amp; Toast</h2>
          <p className={styles.sectionDescription}>Components §4.13, §4.14.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <div className={styles.row}>
              <Button variant="secondary" onClick={() => setModalOpen(true)}>
                Open modal
              </Button>
              <Button variant="secondary" onClick={() => setToastVisible(true)}>
                Show toast
              </Button>
            </div>
          </div>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Confirm delivery order"
            footer={
              <>
                <Button variant="tertiary" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setModalOpen(false)}>
                  Confirm
                </Button>
              </>
            }
          >
            Example modal body content.
          </Modal>
          {toastVisible && (
            <Toast message="Today's sales saved" status="success" onDismiss={() => setToastVisible(false)} />
          )}
        </section>

        <section id="empty" className={styles.section}>
          <h2 className={styles.sectionHeading}>Empty State</h2>
          <p className={styles.sectionDescription}>Components §4.15.</p>
          <div className={styles.tile} style={{ gridColumn: "1 / -1" }}>
            <EmptyState
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="18" height="13" rx="2" />
                  <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              }
              heading="No items yet"
              body="Add your first item to start tracking stock."
              actionLabel="Add item"
              onAction={() => {}}
            />
          </div>
        </section>

        <section id="wordmark" className={styles.section}>
          <h2 className={styles.sectionHeading}>Wordmark</h2>
          <p className={styles.sectionDescription}>
            Components §4.1/§4.12 — small inline nav/header mark, distinct from the login
            screen&apos;s standalone large logo treatment.
          </p>
          <div className={styles.grid}>
            <div className={styles.tile}>
              <p className={styles.tileLabel}>Light surface</p>
              <Wordmark />
            </div>
            <div className={[styles.tile, styles.darkSurface].join(" ")}>
              <p className={styles.tileLabel}>Dark surface</p>
              <Wordmark onDark />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
