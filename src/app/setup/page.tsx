"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo from "@/app/assets/logo2.svg";
import "./setup.css"
type DetectedKey = {
  id: string;
  label: string;
};

type ModelOption = {
  id: string;
  label: string;
  desc: string;
  installed: boolean;
};

const DEFAULT_MODEL = "ggml-tiny-q5_1.bin";

type LanguageOption = {
  id: string;
  label: string;
};

type PermissionStatus = {
  platform: string;
  requiresPermissions: boolean;
  accessibilityGranted: boolean;
};

declare global {
  interface Window {
    voiceOS: {
      getConfig: () => Promise<{
        triggerKey: string;
        model?: string;
        primaryLanguage?: string;
        secondaryLanguage?: string;
        setupComplete: boolean;
      }>;

      getModelOptions: () => Promise<ModelOption[]>;
      setModel: (modelId: string) => Promise<unknown>;
      getLanguageOptions: () => Promise<LanguageOption[]>;
      setLanguagePrefs: (primary: string, secondary: string) => Promise<unknown>;
      startDictationTest: () => Promise<boolean>;

      getPermissionStatus: () => Promise<PermissionStatus>;
      openAccessibilitySettings: () => Promise<boolean>;
      openInputMonitoringSettings: () => Promise<boolean>;
      closeSetupWindow: () => void;

      setTriggerKey: (
        keyId: string
      ) => Promise<{ triggerKey: string; setupComplete: boolean }>;

      finishSetup: (keyId: string, modelId?: string) => Promise<boolean>;

      startKeyCapture: (
        callback: (key: DetectedKey) => void
      ) => void;

      stopKeyCapture: () => void;

      onAltState: (callback: (isDown: boolean) => void) => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type Step =
  | "welcome"
  | "permissions"
  | "current-key"
  | "change-key"
  | "model"
  | "language"
  | "test"
  | "done";

// Steps shown in the progress dots, in order. "done" gets a checkmark
// instead of dots, and "change-key" shares its dot with "current-key"
// since it's just a sub-flow of picking the trigger key.
const DOT_STEPS: Step[] = [
  "welcome",
  "permissions",
  "current-key",
  "model",
  "language",
  "test",
];

function dotIndexForStep(step: Step): number {
  if (step === "change-key") {
    return DOT_STEPS.indexOf("current-key");
  }

  return DOT_STEPS.indexOf(step);
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("welcome");

  const [currentKey, setCurrentKey] = useState<string>("ALT");
  const [selectedKey, setSelectedKey] = useState<DetectedKey | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus | null>(null);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [primaryLang, setPrimaryLang] = useState<string>("auto");
  const [secondaryLang, setSecondaryLang] = useState<string>("none");

  const [testText, setTestText] = useState("");
  const testInputRef = useRef<HTMLTextAreaElement | null>(null);

  // -------------------------------------------------------------------------
  // Load existing config
  // -------------------------------------------------------------------------

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await window.voiceOS?.getConfig?.();

        if (config?.triggerKey) {
          setCurrentKey(config.triggerKey.toUpperCase());
        }

        if (config?.model) {
          setModel(config.model);
        }

        if (config?.primaryLanguage) {
          setPrimaryLang(config.primaryLanguage);
        }

        if (config?.secondaryLanguage) {
          setSecondaryLang(config.secondaryLanguage);
        }

        const langOptions = await window.voiceOS?.getLanguageOptions?.();

        if (langOptions) {
          setLanguageOptions(langOptions);
        }

        const options = await window.voiceOS?.getModelOptions?.();

        if (options) {
          setModels(options);
        }
      } catch (error) {
        console.error("Failed to load Voca config:", error);
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, []);

  // -------------------------------------------------------------------------
  // Poll permission status while on the permissions step
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step !== "permissions") return;

    let cancelled = false;

    async function checkPermissions() {
      try {
        const status = await window.voiceOS?.getPermissionStatus?.();

        if (!cancelled && status) {
          setPermissionStatus(status);
        }
      } catch (error) {
        console.error("Failed to read permission status:", error);
      }
    }

    checkPermissions();

    const interval = setInterval(checkPermissions, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step]);

  // -------------------------------------------------------------------------
  // Start keyboard detection
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step !== "change-key") {
      window.voiceOS?.stopKeyCapture?.();
      return;
    }

    setSelectedKey(null);

    window.voiceOS?.startKeyCapture?.((key) => {
      console.log("Detected key:", key);

      setSelectedKey(key);
    });

    return () => {
      window.voiceOS?.stopKeyCapture?.();
    };
  }, [step]);

  // -------------------------------------------------------------------------
  // Test step: start the dictation overlay and focus the input so the
  // pasted transcript lands in it
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step !== "test") return;

    window.voiceOS?.startDictationTest?.();

    const t = setTimeout(() => testInputRef.current?.focus(), 150);

    return () => clearTimeout(t);
  }, [step]);

  // -------------------------------------------------------------------------
  // Save selected key (from change-key step) without finishing setup yet
  // -------------------------------------------------------------------------

  async function handleSaveKey() {
    if (!selectedKey || saving) return;

    setSaving(true);

    try {
      await window.voiceOS?.setTriggerKey?.(selectedKey.id);

      setCurrentKey(selectedKey.label.toUpperCase());
      setStep("model");
    } catch (error) {
      console.error("Failed to save trigger key:", error);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Finish without changing key — move on to the model step
  // -------------------------------------------------------------------------

  function handleContinueWithCurrentKey() {
    setStep("model");
  }

  // -------------------------------------------------------------------------
  // Model step -> test step. Save the model now so the test uses it.
  // -------------------------------------------------------------------------

  async function handleContinueFromModel() {
    if (saving) return;

    setSaving(true);

    try {
      await window.voiceOS?.setModel?.(model);

      setStep("language");
    } catch (error) {
      console.error("Failed to save model:", error);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Language step: one primary language (or Auto) and an optional
  // secondary language. The secondary can't be the primary, and is
  // ignored when the primary is Auto.
  // -------------------------------------------------------------------------

  function choosePrimary(id: string) {
    setPrimaryLang(id);

    if (id === "auto" || id === secondaryLang) {
      setSecondaryLang("none");
    }
  }

  async function handleContinueFromLanguage() {
    if (saving) return;

    setSaving(true);

    try {
      await window.voiceOS?.setLanguagePrefs?.(primaryLang, secondaryLang);

      setStep("test");
    } catch (error) {
      console.error("Failed to save languages:", error);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Finish setup for real, from the test step
  // -------------------------------------------------------------------------

  async function handleFinishSetup() {
    if (saving) return;

    setSaving(true);

    try {
      await window.voiceOS?.finishSetup?.(currentKey.toLowerCase(), model);

      setStep("done");
    } catch (error) {
      console.error("Failed to finish setup:", error);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <main className="setup-page">
        <div className="setup-card">
          <div className="setup-logo">
            <Image
              src={logo}
              alt="Voca logo"
              width={150}
              priority
            />
          </div>

          <p className="setup-hint">
            Loading Voca…
          </p>
        </div>
      </main>
    );
  }

  const accessibilityGranted =
    permissionStatus?.accessibilityGranted ?? false;

  const permissionsRequired =
    permissionStatus?.requiresPermissions ?? false;

  const canContinuePastPermissions =
    !permissionsRequired || accessibilityGranted;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <main className="setup-page">
      <div className="setup-card">

        {step !== "done" && (
          <div className="step-dots">
            {DOT_STEPS.map((dotStep, index) => {
              const current = dotIndexForStep(step);

              let className = "step-dot";

              if (index === current) {
                className += " step-dot-active";
              } else if (index < current) {
                className += " step-dot-done";
              }

              return <span key={dotStep} className={className} />;
            })}
          </div>
        )}

        {/* ================================================================
            STEP 1 — WELCOME
        ================================================================= */}

        {step === "welcome" && (
          <>
            <div className="setup-logo">
              <Image
                src={logo}
                alt="Voca logo"
                width={150}
                priority
              />
            </div>

            <h1 className="setup-title">
              Set up Voca
            </h1>

            <p className="setup-subtitle">
              Let&apos;s get your voice shortcut configured
              in a couple of steps.
            </p>

            <div className="step-actions">
              <button
                type="button"
                className="finish-btn"
                onClick={() => setStep("permissions")}
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 2 — PERMISSIONS
        ================================================================= */}

        {step === "permissions" && (
          <>
            <h1 className="setup-title">
              Grant permissions
            </h1>

            <p className="setup-subtitle">
              Voca watches for your trigger key system-wide, so
              macOS needs you to allow it in two places.
            </p>

            <div className="permission-list">
              <div className="permission-row">
                <div className="permission-info">
                  <span className="permission-name">
                    Accessibility
                  </span>
                  <span className="permission-desc">
                    {/* Lets Voca detect your trigger key while
                    you&apos;re in any app. */}
                  </span>
                </div>

                {accessibilityGranted ? (
                  <span className="permission-status permission-status-granted">
                    <span className="permission-dot permission-dot-granted" />
                    Granted
                  </span>
                ) : (
                  <button
                    type="button"
                    className="permission-open-btn"
                    onClick={() =>
                      window.voiceOS?.openAccessibilitySettings?.()
                    }
                  >
                    Open Settings
                  </button>
                )}
              </div>

              <div className="permission-row">
                <div className="permission-info">
                  <span className="permission-name">
                    Input Monitoring
                  </span>
                  {/* <span className="permission-desc">
                    Also required on newer macOS versions.
                    Voca may need a restart after you enable it.
                  </span> */}
                </div>

                <button
                  type="button"
                  className="permission-open-btn"
                  onClick={() =>
                    window.voiceOS?.openInputMonitoringSettings?.()
                  }
                >
                  Open Settings
                </button>
              </div>
            </div>

            {!permissionsRequired && (
              <p className="setup-hint">
                Your platform doesn&apos;t require these
                permissions — you&apos;re all set here.
              </p>
            )}

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("welcome")}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                disabled={!canContinuePastPermissions}
                onClick={() => setStep("current-key")}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 3 — CURRENT KEY
        ================================================================= */}

        {step === "current-key" && (
          <>
            <h1 className="setup-title">
              Your trigger key
            </h1>

            <p className="setup-subtitle">
              Hold this key down to bring up Voca.
            </p>

            <div className="current-key-display">
              <div className="keyboard-key key">
                <span>
                {currentKey}</span>
              </div>
            </div>

            <button
              type="button"
              className="change-key-btn"
              onClick={() => setStep("change-key")}
            >
              Want to change key?
            </button>

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("permissions")}
                disabled={saving}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                onClick={handleContinueWithCurrentKey}
                disabled={saving}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 4 — DETECT KEY
        ================================================================= */}

        {step === "change-key" && (
          <>
            <h1 className="setup-title">
              Choose your trigger key
            </h1>

            <p className="setup-subtitle">
              Press any key on your keyboard.
            </p>

            <div className="key-detection-area">
              <div
                className={
                  selectedKey
                    ? "keyboard-key detected"
                    : "keyboard-key listening"
                }
              >
                {selectedKey ? (
                  selectedKey.label
                ) : (
                  <span className="key-placeholder">
                    ?
                  </span>
                )}
              </div>

              <p className="setup-hint">
                {selectedKey
                  ? "Key detected"
                  : "Waiting for a key…"}
              </p>
            </div>

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("current-key")}
                disabled={saving}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                onClick={handleSaveKey}
                disabled={!selectedKey || saving}
              >
                {saving ? "Saving…" : "Save →"}
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 5 — CHOOSE MODEL
        ================================================================= */}

        {step === "model" && (
          <>
            <h1 className="setup-title">
              Choose a model
            </h1>

            <p className="setup-subtitle">
              Smaller models are faster, larger ones are more accurate.
            </p>

            <div className="model-list">
              {models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={!m.installed}
                  className={
                    "model-option" +
                    (model === m.id ? " model-option-selected" : "") +
                    (!m.installed ? " model-option-missing" : "")
                  }
                  onClick={() => setModel(m.id)}
                >
                  <span className="model-info">
                    <span className="model-name">{m.label}</span>
                    <span className="model-desc">
                      {m.installed ? m.desc : "Not installed"}
                    </span>
                  </span>

                  <span className="model-radio" />
                </button>
              ))}
            </div>

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("current-key")}
                disabled={saving}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                onClick={handleContinueFromModel}
                disabled={saving || !models.some((m) => m.id === model && m.installed)}
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 6 — LANGUAGES
        ================================================================= */}

        {step === "language" && (
          <>
            <h1 className="setup-title">
              Choose languages
            </h1>

            <p className="setup-subtitle">
              Voca uses your primary language. Add a secondary language and
              press Ctrl + Shift + L any time to switch between the two.
            </p>

            <p className="lang-section-title">Primary language</p>

            <div className="lang-list">
              {languageOptions.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={
                    "lang-chip" +
                    (primaryLang === l.id ? " lang-chip-selected" : "")
                  }
                  onClick={() => choosePrimary(l.id)}
                >
                  {l.label}
                </button>
              ))}
            </div>

            <p className="lang-section-title">
              Secondary language (optional)
            </p>

            <div
              className={
                "lang-list" +
                (primaryLang === "auto" ? " lang-list-disabled" : "")
              }
            >
              <button
                type="button"
                disabled={primaryLang === "auto"}
                className={
                  "lang-chip" +
                  (secondaryLang === "none" ? " lang-chip-selected" : "")
                }
                onClick={() => setSecondaryLang("none")}
              >
                None
              </button>

              {languageOptions
                .filter((l) => l.id !== "auto" && l.id !== primaryLang)
                .map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    disabled={primaryLang === "auto"}
                    className={
                      "lang-chip" +
                      (secondaryLang === l.id ? " lang-chip-selected" : "")
                    }
                    onClick={() => setSecondaryLang(l.id)}
                  >
                    {l.label}
                  </button>
                ))}
            </div>

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("model")}
                disabled={saving}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                onClick={handleContinueFromLanguage}
                disabled={saving}
              >
                {saving ? "Saving…" : "Continue →"}
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 7 — TEST IT
        ================================================================= */}

        {step === "test" && (
          <>
            <h1 className="setup-title">
              Try it out
            </h1>

            <p className="setup-subtitle">
              Click the box, then hold <strong>{currentKey}</strong> and
              speak. Your words will appear here.
              {secondaryLang !== "none" && primaryLang !== "auto" && (
                <> Press <strong>Ctrl + Shift + L</strong> to switch language.</>
              )}
            </p>

            <textarea
              ref={testInputRef}
              className="test-input"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              placeholder="Hold your key and start talking…"
              rows={4}
            />

            <div className="step-actions">
              <button
                type="button"
                className="back-btn"
                onClick={() => setStep("language")}
                disabled={saving}
              >
                ← Back
              </button>

              <button
                type="button"
                className="finish-btn"
                onClick={handleFinishSetup}
                disabled={saving}
              >
                {saving ? "Finishing…" : "Finish setup →"}
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 8 — DONE
        ================================================================= */}

        {step === "done" && (
          <>
            <div className="setup-logo">
              <Image
                src={logo}
                alt="Voca logo"
                width={150}
              />
            </div>

            <h1 className="setup-title">
              You&apos;re all set
            </h1>

            <p className="setup-subtitle">
              Voca is ready to use.
            </p>

            <div className="final-key">
              <span>Trigger key</span>

              <div className="keyboard-key small">
                {currentKey}
              </div>
            </div>

            <div className="step-actions">
              <button
                type="button"
                className="finish-btn"
                onClick={() => {
                  window.voiceOS?.closeSetupWindow?.();
                }}
              >
                Finish
              </button>
            </div>
          </>
        )}

      </div>
    </main>
  );
}