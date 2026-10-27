"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import logo from "@/app/assets/Glassy Twin Triangles on White.png";
import "./setup.css";

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
  inputMonitoringGranted: boolean;
  microphoneGranted: boolean;
};

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

// Steps shown in the progress dots, in order. "done" gets no dots, and
// "change-key" shares its dot with "current-key" since it's a sub-flow.
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

// ---------------------------------------------------------------------------
// Permission icons (inline so there are no asset dependencies)
// ---------------------------------------------------------------------------

function PermissionIcon({ id }: { id: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (id === "microphone") {
    return (
      <svg {...common}>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v3" />
      </svg>
    );
  }

  if (id === "accessibility") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="8" r="1" />
        <path d="M8 10.5l4 .8 4-.8" />
        <path d="M12 11.3V15l-1.8 3M12 15l1.8 3" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="permission-check"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
    >
      <circle cx="8" cy="8" r="8" fill="#4caf7d" />
      <path
        d="M4.6 8.3l2.2 2.2 4.6-4.8"
        fill="none"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>("welcome");

  const [currentKey, setCurrentKey] = useState<string>("ALT");
  const [selectedKey, setSelectedKey] = useState<DetectedKey | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus | null>(null);
  const [requestingMic, setRequestingMic] = useState(false);
  const [justGranted, setJustGranted] = useState(false);
  const prevPermissionsRef = useRef<PermissionStatus | null>(null);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<string>(DEFAULT_MODEL);

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [primaryLang, setPrimaryLang] = useState<string>("auto");
  const [secondaryLang, setSecondaryLang] = useState<string>("none");

  const [testText, setTestText] = useState("");
  const testInputRef = useRef<HTMLTextAreaElement | null>(null);

  // -------------------------------------------------------------------------
  // Load existing config and model install status
  // -------------------------------------------------------------------------

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await window.voiceOS?.getConfig?.();

        if (config?.triggerKey) {
          setCurrentKey(config.triggerKey.toUpperCase());
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
          const mapped: ModelOption[] = options.map((option: any) => ({
            id: option.id,
            label: option.label,
            desc: option.installed ? "Ready to use" : "Not installed",
            installed: Boolean(option.installed),
          }));

          setModels(mapped);

          // Pick the saved model if it's installed, otherwise the first installed one
          const savedId = config?.model ?? DEFAULT_MODEL;

          if (mapped.some((m) => m.id === savedId && m.installed)) {
            setModel(savedId);
          } else {
            const firstInstalled = mapped.find((m) => m.installed);
            if (firstInstalled) {
              setModel(firstInstalled.id);
            }
          }
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
          const prev = prevPermissionsRef.current;

          // Accessibility and Input Monitoring only take effect after a
          // restart, so remember if one flipped to granted while we watched.
          if (
            prev &&
            ((!prev.accessibilityGranted && status.accessibilityGranted) ||
              (!prev.inputMonitoringGranted && status.inputMonitoringGranted))
          ) {
            setJustGranted(true);
          }

          prevPermissionsRef.current = status;
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
  // Permission actions
  // -------------------------------------------------------------------------

  async function handleRequestMicrophone() {
    if (requestingMic) return;

    setRequestingMic(true);

    try {
      await window.voiceOS?.requestMicrophone?.();
    } catch (error) {
      console.error("Failed to request microphone access:", error);
    } finally {
      setRequestingMic(false);
    }
  }

  // -------------------------------------------------------------------------
  // Save selected key (from change-key step)
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
  // Keep current key and move on to the model step
  // -------------------------------------------------------------------------

  function handleContinueWithCurrentKey() {
    setStep("model");
  }

  // -------------------------------------------------------------------------
  // Model step -> language step. Save the model only if it's installed.
  // -------------------------------------------------------------------------

  async function handleContinueFromModel() {
    if (saving) return;

    const selected = models.find((m) => m.id === model);
    if (!selected?.installed) return;

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
            <Image src={logo} alt="Voca logo" width={150} priority />
          </div>

          <p className="setup-hint">Loading Voca…</p>
        </div>
      </main>
    );
  }

  const permissionsLoaded = permissionStatus !== null;
  const permissionsRequired = permissionStatus?.requiresPermissions ?? false;
  const accessibilityGranted = permissionStatus?.accessibilityGranted ?? false;
  const inputMonitoringGranted =
    permissionStatus?.inputMonitoringGranted ?? false;
  const microphoneGranted = permissionStatus?.microphoneGranted ?? false;

  const permissionItems = [
    {
      id: "microphone",
      name: "Microphone",
      desc: "Hear your voice",
      granted: microphoneGranted,
      actionLabel: requestingMic ? "Asking…" : "Allow",
      busy: requestingMic,
      onAction: handleRequestMicrophone,
    },
    {
      id: "accessibility",
      name: "Accessibility",
      desc: "Type into your apps",
      granted: accessibilityGranted,
      actionLabel: "Open Settings",
      busy: false,
      onAction: () => window.voiceOS?.openAccessibilitySettings?.(),
    },
    {
      id: "input-monitoring",
      name: "Input Monitoring",
      desc: "Detect your trigger key",
      granted: inputMonitoringGranted,
      actionLabel: "Open Settings",
      busy: false,
      onAction: () => window.voiceOS?.openInputMonitoringSettings?.(),
    },
  ];

  const grantedCount = permissionItems.filter((p) => p.granted).length;

  // Don't let people through before the first status check has come back
  const canContinuePastPermissions =
    permissionsLoaded &&
    (!permissionsRequired || grantedCount === permissionItems.length);

  const selectedModelInstalled = models.some(
    (m) => m.id === model && m.installed,
  );

  const noModelsInstalled = models.length > 0 && models.every((m) => !m.installed);

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
              <Image src={logo} alt="Voca logo" width={150} priority />
            </div>

            <h1 className="setup-title">Set up Voca</h1>

            <p className="setup-subtitle">
              Let&apos;s get your voice shortcut configured in a couple of
              steps.
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
            <h1 className="setup-title">Allow access</h1>

            <p className="setup-subtitle">
              Voca needs a few permissions to hear you and type for you. Your
              voice is transcribed on this device.
            </p>

            {!permissionsLoaded ? (
              <p className="setup-hint">Checking permissions…</p>
            ) : permissionsRequired ? (
              <>
                <div
                  className="permission-progress"
                  role="status"
                  aria-live="polite"
                >
                  <div className="permission-progress-track">
                    <div
                      className="permission-progress-fill"
                      style={{
                        width: `${(grantedCount / permissionItems.length) * 100}%`,
                      }}
                    />
                  </div>

                  <span className="permission-progress-label">
                    {grantedCount} of {permissionItems.length} allowed
                  </span>
                </div>

                <div className="permission-list">
                  {permissionItems.map((item) => (
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
                          Allowed
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

                {!inputMonitoringGranted && (
                  <p className="permission-note">
                    After turning on Input Monitoring, press your trigger key
                    once anywhere. That&apos;s how Voca confirms it.
                  </p>
                )}

                {justGranted && (
                  <p className="permission-note">
                    Just allowed something in Settings? If it doesn&apos;t show
                    up here, quit and reopen Voca.
                  </p>
                )}
              </>
            ) : (
              <div className="permission-empty">
                <CheckIcon />
                <p>Nothing to allow on this system. You&apos;re good to go.</p>
              </div>
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
            <h1 className="setup-title">Your trigger key</h1>

            <p className="setup-subtitle">
              Hold this key down to bring up Voca.
            </p>

            <div className="current-key-display">
              <div className="keyboard-key key">
                <span>{currentKey}</span>
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
            <h1 className="setup-title">Choose your trigger key</h1>

            <p className="setup-subtitle">Press any key on your keyboard.</p>

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
                  <span className="key-placeholder">?</span>
                )}
              </div>

              <p className="setup-hint">
                {selectedKey ? "Key detected" : "Waiting for a key…"}
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
            <h1 className="setup-title">Choose a model</h1>

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
                    <span className="model-desc">{m.desc}</span>
                  </span>

                  <span className="model-radio" />
                </button>
              ))}
            </div>

            {noModelsInstalled && (
              <p className="setup-hint">
                No models found. Copy a ggml model file into{" "}
                <code>resources/models</code> and restart Voca.
              </p>
            )}

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
                disabled={saving || !selectedModelInstalled}
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
            <h1 className="setup-title">Choose languages</h1>

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

            <p className="lang-section-title">Secondary language (optional)</p>

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
            <h1 className="setup-title">Try it out</h1>

            <p className="setup-subtitle">
              Click the box, then hold <strong>{currentKey}</strong> and speak.
              Your words will appear here.
              {secondaryLang !== "none" && primaryLang !== "auto" && (
                <>
                  {" "}
                  Press <strong>Ctrl + Shift + L</strong> to switch language.
                </>
              )}{" "}
              Want an emoji? Say <strong>“emoji heart”</strong> and you&apos;ll
              get ❤️ — try <strong>“emoji fire”</strong> or{" "}
              <strong>“emoji thumbs up”</strong> too.
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
              <Image src={logo} alt="Voca logo" width={150} />
            </div>

            <h1 className="setup-title">You&apos;re all set</h1>

            <p className="setup-subtitle">Voca is ready to use.</p>

            <div className="final-key">
              <span>Trigger key</span>

              <div className="keyboard-key small">{currentKey}</div>
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