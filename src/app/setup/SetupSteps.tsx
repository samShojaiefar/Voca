"use client";

// Presentational step components. They only receive props: no window.voca,
// no localStorage, no effects. All behaviour comes from useSetup().
// (LanguageSelect keeps purely local UI state: open / query / highlighted row.)

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import logo from "@/app/assets/Glassy Twin Triangles on White.png";
import { CheckIcon, PermissionIcon } from "./SetupIcons";
import {
  DESIGNS,
  DOT_STEPS,
  FONTS,
  dotIndexForStep,
  type Step,
} from "./setup.types";
import type { SetupState } from "./useSetup";
import {
  AudioLines,
  ChevronDown,
  Keyboard,
  Mic,
  PersonStanding,
  Search,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function StepDots({ step }: { step: Step }) {
  const current = dotIndexForStep(step);

  return (
    <div className="step-dots">
      {DOT_STEPS.map((dotStep, index) => {
        let className = "step-dot";

        if (index === current) {
          className += " step-dot-active";
        } else if (index < current) {
          className += " step-dot-done";
        }

        return <span key={dotStep} className={className} />;
      })}
    </div>
  );
}

export function LoadingCard() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="setup-logo">
          <Image src={logo} alt="Voca logo" width={150} priority />
        </div>

        <p className="setup-hint">Loading Voca…</p>
      </div>
    </main>
  );
}

type StepNavProps = {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel: string;
  backDisabled?: boolean;
  nextDisabled?: boolean;
};

function StepActions({
  onBack,
  onNext,
  nextLabel,
  backDisabled,
  nextDisabled,
}: StepNavProps) {
  return (
    <div className="step-actions">
      {onBack && (
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          disabled={backDisabled}
        >
          ← Back
        </button>
      )}

      <button
        type="button"
        className="finish-btn"
        onClick={onNext}
        disabled={nextDisabled}
      >
        <span> {nextLabel}</span>
      </button>
    </div>
  );
}

function LanguageSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
  disabled?: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? options.filter((o) => o.label.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  function openMenu() {
    if (disabled) return;
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.id === value),
      ),
    );
    setOpen(true);
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
  }

  function choose(id: T) {
    onChange(id);
    closeMenu();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  }

  return (
    <div
      ref={rootRef}
      className={"lang-select" + (disabled ? " lang-select-disabled" : "")}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) {
          closeMenu();
        }
      }}
    >
      <button
        type="button"
        className="lang-select-trigger"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
      >
        <span>{selected?.label ?? "Select…"}</span>
        <ChevronDown size={16} />
      </button>

      {open && (
        <div className="lang-select-menu">
          <div className="lang-select-search">
            <Search size={14} />
            <input
              autoFocus
              type="text"
              value={query}
              placeholder="Search languages…"
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={handleKeyDown}
            />
          </div>

          <ul className="lang-select-list" role="listbox" aria-label={label}>
            {filtered.length === 0 ? (
              <li className="lang-select-empty">No languages found</li>
            ) : (
              filtered.map((o, i) => (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={o.id === value}
                  ref={
                    i === active
                      ? (el) => el?.scrollIntoView({ block: "nearest" })
                      : undefined
                  }
                  className={
                    "lang-select-option" +
                    (i === active ? " lang-select-option-active" : "") +
                    (o.id === value ? " lang-select-option-selected" : "")
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.id)}
                >
                  {o.label}
                  {/* {o.id === value && <CheckIcon />} */}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div className="setup-logo">
        <Image src={logo} alt="Voca logo" width={150} priority />
      </div>

      <h1 className="setup-title">Set up Voca</h1>

      <p className="setup-subtitle">
        Let&apos;s get your voice shortcut configured in a couple of steps.
      </p>

      <StepActions onNext={onNext} nextLabel="Next" />
    </>
  );
}

export function PermissionsStep({
  permissions,
  onBack,
  onNext,
}: {
  permissions: SetupState["permissions"];
  onBack: () => void;
  onNext: () => void;
}) {
  const { loaded, required, items, grantedCount } = permissions;

  return (
    <>
      <h1 className="setup-title">Grant permissions</h1>

      <p className="setup-subtitle">
        Voca needs a few permissions to hear you and type for you. Your voice is
        transcribed on this device.
      </p>

      {!loaded ? (
        <p className="setup-hint">Checking permissions…</p>
      ) : required ? (
        <>
          <div className="permission-progress" role="status" aria-live="polite">
            <div className="permission-progress-track">
              <div
                className="permission-progress-fill"
                style={{ width: `${(grantedCount / items.length) * 100}%` }}
              />
            </div>

            <span className="permission-progress-label">
              {grantedCount} of {items.length} granted
            </span>
          </div>

          <div className="permission-list">
            {items.map((item) => (
              <div
                key={item.id}
                className={
                  "permission-row" +
                  (item.granted ? " permission-row-granted" : "")
                }
              >
                <span className="permission-icon">
                  <PermissionIcon id={item.id} />
                </span>

                <div className="permission-info">
                  <span className="permission-name">{item.name}</span>
                  <span className="permission-desc">{item.desc}</span>
                </div>

                {item.granted ? (
                  <span className="permission-status permission-status-granted">
                    <CheckIcon />
                    Granted
                  </span>
                ) : (
                  <button
                    type="button"
                    className="permission-open-btn"
                    disabled={item.busy}
                    onClick={item.onAction}
                  >
                    {item.actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>

          {!permissions.inputMonitoringGranted && (
            <p className="permission-note">
              After turning on Input Monitoring, press your trigger key once
              anywhere. That&apos;s how Voca confirms it.
            </p>
          )}

          {permissions.justGranted && (
            <p className="permission-note">
              Just allowed something in Settings? If it doesn&apos;t show up
              here, quit and reopen Voca.
            </p>
          )}
        </>
      ) : (
        <div className="">
          {/* <div className="icon-container">
            <div className="iconaccess">
              <Mic color="#6599C6" />
            </div>
            <div className="iconaccess">
              <AudioLines color="#6599C6" />
            </div>
            <div className="iconaccess">
              <Keyboard color="#6599C6" />
            </div>
          </div> */}
          <div className="permission-empty">
            <CheckIcon />
            <p>Nothing to allow on this system. You&apos;re good to go.</p>
          </div>
        </div>
      )}

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="Continue →"
        nextDisabled={!permissions.canContinue}
      />
    </>
  );
}

export function CurrentKeyStep({
  currentKey,
  saving,
  onChangeKey,
  onBack,
  onNext,
}: {
  currentKey: string;
  saving: boolean;
  onChangeKey: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h1 className="setup-title">Your trigger key</h1>

      <p className="setup-subtitle">Hold this key down to bring up Voca.</p>

      <div className="current-key-display">
        <div className="keyboard-key key">
          <span>{currentKey}</span>
        </div>
      </div>

      <button type="button" className="change-key-btn" onClick={onChangeKey}>
        Want to change key?
      </button>

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="Continue →"
        backDisabled={saving}
        nextDisabled={saving}
      />
    </>
  );
}

export function ChangeKeyStep({
  selectedKey,
  saving,
  onBack,
  onSave,
}: {
  selectedKey: SetupState["selectedKey"];
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <h1 className="setup-title">Choose your trigger key</h1>

      <p className="setup-subtitle">Press any key on your keyboard.</p>

      <div className="key-detection-area">
        <div
          className={
            selectedKey ? "keyboard-key detected" : "keyboard-key listening"
          }
        >
          {selectedKey ? (
            selectedKey.label
          ) : (
            <span className="key-placeholder">?</span>
          )}
        </div>

        <p className="setup-hint">
          {selectedKey ? "Key detected" : "Waiting for a key…"}
        </p>
      </div>

      <StepActions
        onBack={onBack}
        onNext={onSave}
        nextLabel={saving ? "Saving…" : "Save →"}
        backDisabled={saving}
        nextDisabled={!selectedKey || saving}
      />
    </>
  );
}
export function LanguageStep({
  languages,
  saving,
  onBack,
  onNext,
}: {
  languages: SetupState["languages"];
  saving: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  const { options, primary, secondary } = languages;
  const primaryIsAuto = primary === "auto";

  const secondaryOptions = [
    { id: "none" as const, label: "None" },
    ...options.filter((l) => l.id !== "auto" && l.id !== primary),
  ];

  return (
    <>
      <h1 className="setup-title">Choose languages</h1>

      <p className="setup-subtitle">
        Voca uses your primary language. Add a secondary language and press Ctrl
        + Shift + L any time to switch between the two.
      </p>

      <p className="lang-section-title">Primary language</p>

      <LanguageSelect
        label="Primary language"
        value={primary}
        options={options}
        onChange={languages.choosePrimary}
      />

      <p className="lang-section-title">Secondary language (optional)</p>

      <LanguageSelect
        label="Secondary language"
        value={secondary}
        options={secondaryOptions}
        onChange={languages.chooseSecondary}
        disabled={primaryIsAuto}
      />

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel={saving ? "Saving…" : "Continue →"}
        backDisabled={saving}
        nextDisabled={saving}
      />
    </>
  );
}

export function DesignStep({
  design,
  onBack,
  onNext,
}: {
  design: SetupState["design"];
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h1 className="setup-title">Choose a design</h1>

      <p className="setup-subtitle">
        Pick how the Voca notch looks while you dictate. You can try it on the
        next step.
      </p>

      <div className="design-list">
        {DESIGNS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={
              "model-option design-option" +
              (design.selected === d.id ? " model-option-selected" : "")
            }
            onClick={() => design.choose(d.id)}
          >
            <span className="design-preview" aria-hidden>
              <span className={"dp-pill dp-pill-" + d.id}>
                <span className="dp-bars">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </span>

            <span className="design-meta">
              <span className="model-info">
                <span className="model-name">{d.label}</span>
                <span className="model-desc">{d.desc}</span>
              </span>

              <span className="model-radio" />
            </span>
          </button>
        ))}
      </div>

      <StepActions onBack={onBack} onNext={onNext} nextLabel="Continue →" />
    </>
  );
}

export function FontStep({
  font,
  onBack,
  onNext,
}: {
  font: SetupState["font"];
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <h1 className="setup-title">Choose a font</h1>

      <p className="setup-subtitle">
        Pick the font for the text shown in the Voca notch.
      </p>

      <div className="design-list">
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={
              "model-option design-option" +
              (font.selected === f.id ? " model-option-selected" : "")
            }
            onClick={() => font.choose(f.id)}
          >
            <span className="design-preview font-preview" aria-hidden>
              <span style={{ fontFamily: f.cssVar + ", sans-serif" }}>
                Voca
              </span>
            </span>

            <span className="design-meta">
              <span className="model-info">
                <span className="model-name">{f.label}</span>
                <span className="model-desc">{f.desc}</span>
              </span>

              <span className="model-radio" />
            </span>
          </button>
        ))}
      </div>

      <StepActions onBack={onBack} onNext={onNext} nextLabel="Continue →" />
    </>
  );
}

export function TestStep({
  currentKey,
  showLanguageSwitchHint,
  test,
  saving,
  onBack,
  onFinish,
}: {
  currentKey: string;
  showLanguageSwitchHint: boolean;
  test: SetupState["test"];
  saving: boolean;
  onBack: () => void;
  onFinish: () => void;
}) {
  return (
    <>
      <h1 className="setup-title">Try it out</h1>

      <p className="setup-subtitle">
        Click the box, then hold <strong>{currentKey}</strong> and speak. Your
        words will appear here.
        {showLanguageSwitchHint && (
          <>
            {" "}
            Press <strong>Ctrl + Shift + L</strong> to switch language.
          </>
        )}{" "}
        Want an emoji? Say <strong>“emoji heart”</strong> and you&apos;ll get ❤️
        — try <strong>“emoji fire”</strong> or{" "}
        <strong>“emoji thumbs up”</strong> too.
      </p>

      <textarea
        ref={test.inputRef}
        className="test-input"
        value={test.text}
        onChange={(e) => test.setText(e.target.value)}
        placeholder="Hold your key and start talking…"
        rows={4}
      />

      <StepActions
        onBack={onBack}
        onNext={onFinish}
        nextLabel={saving ? "Finishing…" : "Finish setup →"}
        backDisabled={saving}
        nextDisabled={saving}
      />
    </>
  );
}

export function DoneStep({
  currentKey,
  onClose,
}: {
  currentKey: string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="setup-logo">
        <Image src={logo} alt="Voca logo" width={150} />
      </div>

      <h1 className="setup-title">You&apos;re all set</h1>

      <p className="setup-subtitle">Voca is ready to use.</p>

      <div className="final-key">
        <span>Trigger key</span>

        <div className="keyboard-key small">{currentKey}</div>
      </div>

      <StepActions onNext={onClose} nextLabel="Finish" />
    </>
  );
}