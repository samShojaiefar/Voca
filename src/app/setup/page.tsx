"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import logo from "@/app/assets/logo2.svg";
import "./setup.css"
type DetectedKey = {
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
        setupComplete: boolean;
      }>;

      getPermissionStatus: () => Promise<PermissionStatus>;
      openAccessibilitySettings: () => Promise<boolean>;
      openInputMonitoringSettings: () => Promise<boolean>;
      closeSetupWindow: () => void;

      setTriggerKey: (
        keyId: string
      ) => Promise<{ triggerKey: string; setupComplete: boolean }>;

      finishSetup: (keyId: string) => Promise<boolean>;

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
  | "test"
  | "done";

// Steps shown in the progress dots, in order. "done" gets a checkmark
// instead of dots, and "change-key" shares its dot with "current-key"
// since it's just a sub-flow of picking the trigger key.
const DOT_STEPS: Step[] = [
  "welcome",
  "permissions",
  "current-key",
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

  const [testActive, setTestActive] = useState(false);

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
  // Live "hold your key" feedback on the test step
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (step !== "test") {
      setTestActive(false);
      return;
    }

    window.voiceOS?.onAltState?.((isDown) => {
      setTestActive(isDown);
    });
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
      setStep("test");
    } catch (error) {
      console.error("Failed to save trigger key:", error);
    } finally {
      setSaving(false);
    }
  }

  // -------------------------------------------------------------------------
  // Finish without changing key — move on to the test step
  // -------------------------------------------------------------------------

  function handleContinueWithCurrentKey() {
    setStep("test");
  }

  // -------------------------------------------------------------------------
  // Finish setup for real, from the test step
  // -------------------------------------------------------------------------

  async function handleFinishSetup() {
    if (saving) return;

    setSaving(true);

    try {
      await window.voiceOS?.finishSetup?.(currentKey.toLowerCase());

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
            STEP 5 — TEST IT
        ================================================================= */}

        {step === "test" && (
          <>
            <h1 className="setup-title">
              Try it out
            </h1>

            <p className="setup-subtitle">
              Hold <strong>{currentKey}</strong> to see Voca
              respond.
            </p>

            <div className="test-hold-area">
              <div
                className={
                  testActive
                    ? "test-capsule test-capsule-active"
                    : "test-capsule"
                }
              />

              <span
                className={
                  testActive
                    ? "test-status test-status-active"
                    : "test-status"
                }
              >
                {testActive
                  ? "Detected — nice work!"
                  : `Hold ${currentKey} now…`}
              </span>
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
                onClick={handleFinishSetup}
                disabled={saving}
              >
                {saving ? "Finishing…" : "Finish setup →"}
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            STEP 6 — DONE
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