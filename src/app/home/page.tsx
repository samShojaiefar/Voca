"use client";

import { useEffect, useState } from "react";
import "./page.css";
import {
  Copy,
  CopyCheck,
  ChevronDown,
  Search,
  Check,
  AlertTriangle,
} from "lucide-react";

// ========================================
// TYPES
// ========================================

type Account = {
  id: string;
  name: string;
  email: string;
  provider: string;
};

type AccountsState = {
  accounts: Account[];
  activeAccountId: string | null;
};

type HistoryItem = {
  id: string;
  text: string;
  at: number;
};

type LanguageOption = {
  id: string;
  label: string;
};

// ========================================
// NOTCH DESIGNS
// Must match setup.types.ts (DESIGNS / DESIGN_STORAGE_KEY / DEFAULT_DESIGN)
// and the theme ids in the notch page.
// ========================================

type DesignId = "notch" | "island";

const DESIGN_STORAGE_KEY = "voca-theme";
const DEFAULT_DESIGN: DesignId = "notch";

const DESIGNS: { id: DesignId; label: string; desc: string }[] = [
  { id: "notch", label: "Notch", desc: "Attached to the top edge" },
  { id: "island", label: "Island", desc: "A floating pill, like Dynamic Island" },
];

const isDesignId = (value: unknown): value is DesignId =>
  DESIGNS.some((d) => d.id === value);

// ========================================
// PRELOAD API
// ========================================

const voca = () => (window as any).voca;

// ========================================
// CUSTOM LANGUAGE SELECT
// ========================================

function LanguageSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: LanguageOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find((option) => option.id === value);

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className={`lang-select ${disabled ? "lang-select-disabled" : ""}`}>
      <button
        type="button"
        className="lang-select-trigger"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          setSearch("");
        }}
      >
        <span>{selected?.label ?? "Select language"}</span>
        <ChevronDown
          size={16}
          className={open ? "lang-select-chevron-open" : ""}
        />
      </button>

      {open && !disabled && (
        <div className="lang-select-menu">
          <div className="lang-select-search">
            <Search size={15} color="#9298a5" />

            <input
              className="searchinput"
              autoFocus
              placeholder="Search languages..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
          </div>

          <ul className="lang-select-list" role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <li
                  key={option.id}
                  className={`lang-select-option ${
                    value === option.id ? "lang-select-option-selected" : ""
                  }`}
                  role="option"
                  aria-selected={value === option.id}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <span>{option.label}</span>
                  {value === option.id && <Check size={15} />}
                </li>
              ))
            ) : (
              <li className="lang-select-empty">No languages found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ========================================
// HOME PAGE
// ========================================

export default function HomePage() {
  // ---- accounts ----

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ name: "", email: "" });

  // ---- history ----

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [saveToFile, setSaveToFile] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // ---- languages ----

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [primaryLanguage, setPrimaryLanguage] = useState("auto");
  const [secondaryLanguage, setSecondaryLanguage] = useState("none");

  const [savingLanguages, setSavingLanguages] = useState(false);
  const [languageSaved, setLanguageSaved] = useState(false);

  const primaryIsAuto = primaryLanguage === "auto";

  const secondaryOptions = [
    { id: "none", label: "None" },
    ...languageOptions.filter(
      (language) => language.id !== "auto" && language.id !== primaryLanguage,
    ),
  ];

  // ---- notch design ----

  const [design, setDesign] = useState<DesignId>(DEFAULT_DESIGN);

  // ========================================
  // LOAD DATA
  // ========================================

  const apply = (result: AccountsState) => {
    setAccounts(result.accounts);
    setActiveId(result.activeAccountId);
  };

  useEffect(() => {
    const api = voca();

    if (!api) return;

    // Accounts
    api.getAccounts().then(apply).catch(console.error);

    // History
    api.getHistory().then(setHistory).catch(console.error);

    // Config
    api
      .getConfig()
      .then((config: any) => {
        setSaveToFile(!!config.saveHistoryToFile);

        setPrimaryLanguage(config.primaryLanguage ?? "auto");
        setSecondaryLanguage(config.secondaryLanguage ?? "none");
      })
      .catch(console.error);

    // Available languages
    api
      .getLanguageOptions()
      .then((options: LanguageOption[]) => {
        setLanguageOptions(options);
      })
      .catch(console.error);

    // Live history updates
    const off = api.onHistoryUpdated((list: HistoryItem[]) => {
      setHistory([...list]);
    });

    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  // Escape closes the clear-history modal
  useEffect(() => {
    if (!confirmClearOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmClearOpen(false);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClearOpen]);

  // Design: read the saved choice, and stay in sync if another window
  // (e.g. the setup window) changes it.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DESIGN_STORAGE_KEY);

      if (isDesignId(saved)) setDesign(saved);
    } catch {
      // storage unavailable: keep the default design
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === DESIGN_STORAGE_KEY && isDesignId(event.newValue)) {
        setDesign(event.newValue);
      }
    };

    window.addEventListener("storage", onStorage);

    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ========================================
  // DESIGN FUNCTIONS
  // ========================================

  // Same key setup uses. The notch window picks it up live through the
  // "storage" event, so no restart is needed.
  const chooseDesign = (id: DesignId) => {
    setDesign(id);

    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, id);
    } catch (error) {
      console.error("Failed to save design:", error);
    }
  };

  // ========================================
  // LANGUAGE FUNCTIONS
  // ========================================

  const choosePrimary = (value: string) => {
    setPrimaryLanguage(value);

    if (value === "auto" || value === secondaryLanguage) {
      setSecondaryLanguage("none");
    }

    setLanguageSaved(false);
  };

  const chooseSecondary = (value: string) => {
    setSecondaryLanguage(value);
    setLanguageSaved(false);
  };

  const saveLanguages = async () => {
    try {
      setSavingLanguages(true);

      await voca().setLanguagePrefs(primaryLanguage, secondaryLanguage);

      setLanguageSaved(true);
    } catch (error) {
      console.error("Failed to save language preferences:", error);
      setLanguageSaved(false);
    } finally {
      setSavingLanguages(false);
    }
  };

  // ========================================
  // HISTORY FUNCTIONS
  // ========================================

  const copy = async (item: HistoryItem) => {
    let textArea: HTMLTextAreaElement | null = null;

    try {
      textArea = document.createElement("textarea");

      textArea.value = item.text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      textArea.style.pointerEvents = "none";

      document.body.appendChild(textArea);

      textArea.select();
      textArea.setSelectionRange(0, textArea.value.length);

      const success = document.execCommand("copy");

      if (!success) throw new Error("Copy failed");

      setCopiedId(item.id);

      setTimeout(() => {
        setCopiedId((current) => (current === item.id ? null : current));
      }, 1200);
    } catch (error) {
      console.error("Failed to copy:", error);
    } finally {
      textArea?.remove();
    }
  };

  const fmt = (time: number) =>
    new Date(time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  // ========================================
  // RENDER
  // ========================================

  return (
    <>
    <main className="dashboard">
      {/* =========================================
          RECENT DICTATIONS
      ========================================= */}

      <section className="dashboard-card">
        <div className="dashboard-header">
          <h2>Recent dictations</h2>

          <button
            className="dashboard-btn"
            disabled={history.length === 0}
            onClick={() => setConfirmClearOpen(true)}
          >
            Clear
          </button>
        </div>

        {history.length === 0 && (
          <div className="history-empty">
            Nothing yet. Hold your trigger key and speak.
          </div>
        )}

        <div className="history-list">
          {history.map((item) => (
            <div className="history-item" key={item.id}>
              <span className="history-time">{fmt(item.at)}</span>

              <span className="history-text">{item.text}</span>

              <button
                className={`copy-btn ${copiedId === item.id ? "copied" : ""}`}
                onClick={() => copy(item)}
                aria-label="Copy dictation"
                title="Copy"
              >
                {copiedId === item.id ? (
                  <CopyCheck size={18} />
                ) : (
                  <Copy size={18} />
                )}
              </button>
            </div>
          ))}
        </div>

        <div className="history-settings">
          <label className="history-save-label">
            <input
              type="checkbox"
              checked={saveToFile}
              onChange={async (event) => {
                const enabled = event.target.checked;

                setSaveToFile(enabled);
                await voca().setSaveHistory(enabled);
              }}
            />
            Also save dictations to a .md file
          </label>

          <button
            className="dashboard-btn"
            onClick={() => voca().openHistoryFolder()}
          >
            Open folder
          </button>
        </div>

        <p className="history-note">
          Saved as one file per day in Documents/Voca. Off by default. Your most
          recent dictations are loaded from these files when the app starts.
          Clearing the list also erases the contents of these files.
        </p>
      </section>

      {/* =========================================
          LANGUAGE SETTINGS
      ========================================= */}

      <section className="dashboard-card">
        <div className="dashboard-header">
          <h2>Languages</h2>
        </div>

        <p className="language-description">
          Choose the languages you use with Voca. Press{" "}
          <kbd className="keyboard-key">Ctrl</kbd>
          {" + "}
          <kbd className="keyboard-key">Shift</kbd>
          {" + "}
          <kbd className="keyboard-key">L</kbd> to switch between your primary
          and secondary languages.
        </p>

        <div className="language-field">
          <label className="language-label">Primary language</label>

          <LanguageSelect
            label="Primary language"
            value={primaryLanguage}
            options={languageOptions}
            onChange={choosePrimary}
          />
        </div>

        <div className="language-field">
          <label className="language-label">
            Secondary language
            <span className="optional-label">Optional</span>
          </label>

          <LanguageSelect
            label="Secondary language"
            value={secondaryLanguage}
            options={secondaryOptions}
            onChange={chooseSecondary}
            disabled={primaryIsAuto}
          />

          {primaryIsAuto && (
            <p className="language-hint">
              Choose a specific primary language to enable a secondary language.
            </p>
          )}
        </div>

        <div className="language-footer">
          <span className="language-status" role="status">
            {languageSaved ? "Preferences saved" : ""}
          </span>

          <button
            className="dashboard-btn primary"
            disabled={savingLanguages}
            onClick={saveLanguages}
          >
            {savingLanguages ? "Saving..." : "Save languages"}
          </button>
        </div>
      </section>

      {/* =========================================
          DESIGN
      ========================================= */}

      <section className="dashboard-card">
        <div className="dashboard-header">
          <h2>Design</h2>
        </div>

        <p className="dsg-description">
          Pick how the Voca notch looks while you dictate. Changes apply
          instantly.
        </p>

        <div className="dsg-list" role="radiogroup" aria-label="Notch design">
          {DESIGNS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={design === d.id}
              className={
                "dsg-option" + (design === d.id ? " dsg-option-selected" : "")
              }
              onClick={() => chooseDesign(d.id)}
            >
              <span className="dsg-preview" aria-hidden>
                <span className={"dsg-pill dsg-pill-" + d.id}>
                  <span className="dsg-bars">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              </span>

              <span className="dsg-meta">
                <span className="dsg-info">
                  <span className="dsg-name">{d.label}</span>
                  <span className="dsg-desc">{d.desc}</span>
                </span>

                <span className="dsg-radio" />
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* =========================================
          SETUP
      ========================================= */}

      <section className="dashboard-card">
        <div className="dashboard-actions">
          <button
            className="dashboard-btn"
            onClick={() => voca().openSetupWindow()}
          >
            Re-run setup
          </button>

          <button
            className="dashboard-btn"
            onClick={async () => {
              await voca().resetSetup();

              alert("Setup reset. Setup will open next time you start Voca.");
            }}
          >
            Reset setup (testing)
          </button>
        </div>
      </section>
    </main>

      {confirmClearOpen && (
        <div
          className="modal-overlay"
          onClick={() => setConfirmClearOpen(false)}
        >
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-modal-title"
            aria-describedby="clear-modal-text"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-icon" aria-hidden>
              <AlertTriangle size={20} />
            </div>

            <h3 id="clear-modal-title" className="modal-title">
              Clear all dictation history?
            </h3>

            <p id="clear-modal-text" className="modal-text">
              This removes everything in the list and erases the contents of
              the saved .md files in Documents/Voca. The files themselves stay.
              This can&apos;t be undone.
            </p>

            <div className="modal-actions">
              <button
                className="dashboard-btn"
                onClick={() => setConfirmClearOpen(false)}
                autoFocus
              >
                Cancel
              </button>

              <button
                className="dashboard-btn danger"
                onClick={async () => {
                  setConfirmClearOpen(false);
                  setHistory(await voca().clearHistory());
                }}
              >
                Clear history
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}