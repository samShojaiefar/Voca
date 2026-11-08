"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_DESIGN,
  DEFAULT_FONT,
  DEFAULT_MODEL,
  DESIGN_STORAGE_KEY,
  FONTS,
  FONT_STORAGE_KEY,
  isDesignId,
  isFontId,
  type CapturedKey,
  type DesignId,
  type FontId,
  type LanguageOption,
  type PermissionItem,
  type PermissionStatus,
  type Step,
} from "./setup.types";

/**
 * All state, effects and side effects (window.voca calls, localStorage)
 * for the setup flow. The UI only reads what this returns.
 */
export function useSetup() {
  const [step, setStep] = useState<Step>("welcome");

  const [currentKey, setCurrentKey] = useState<string>("ALT");
  const [selectedKey, setSelectedKey] = useState<CapturedKey | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [permissionStatus, setPermissionStatus] =
    useState<any>(null);
  const [requestingMic, setRequestingMic] = useState(false);
  const [justGranted, setJustGranted] = useState(false);
  const prevPermissionsRef = useRef<any>(null);

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [primaryLang, setPrimaryLang] = useState<string>("auto");
  const [secondaryLang, setSecondaryLang] = useState<string>("none");

  const [design, setDesign] = useState<DesignId>(DEFAULT_DESIGN);
  const [font, setFont] = useState<FontId>(DEFAULT_FONT);

  const [testText, setTestText] = useState("");
  const testInputRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- Load existing config -----------------------------------------------

  useEffect(() => {
    async function loadConfig() {
      try {
        const savedDesign = localStorage.getItem(DESIGN_STORAGE_KEY);

        if (isDesignId(savedDesign)) {
          setDesign(savedDesign);
        }
      } catch {
        // storage unavailable — keep the default design
      }

      try {
        const savedFont = localStorage.getItem(FONT_STORAGE_KEY);

        if (isFontId(savedFont)) {
          setFont(savedFont);
          document.documentElement.style.setProperty(
            "--notch-font",
            FONTS.find((f) => f.id === savedFont)!.cssVar,
          );
        }
      } catch {
        // storage unavailable — keep the default font
      }

      try {
        const config = await window.voca?.getConfig?.();

        if (config?.triggerKey) {
          setCurrentKey(config.triggerKey.toUpperCase());
        }

        if (config?.primaryLanguage) {
          setPrimaryLang(config.primaryLanguage);
        }

        if (config?.secondaryLanguage) {
          setSecondaryLang(config.secondaryLanguage);
        }

        const langOptions = await window.voca?.getLanguageOptions?.();

        if (langOptions) {
          setLanguageOptions(langOptions);
        }
      } catch (error) {
        console.error("Failed to load Voca config:", error);
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, []);

  // ---- Poll permission status while on the permissions step ---------------

  useEffect(() => {
    if (step !== "permissions") return;

    let cancelled = false;

    async function checkPermissions() {
      try {
        const status = (await window.voca?.getPermissionStatus?.()) as unknown as
          | PermissionStatus
          | undefined;
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

  // ---- Keyboard detection -------------------------------------------------

  useEffect(() => {
    if (step !== "change-key") {
      window.voca?.stopKeyCapture?.();
      return;
    }

    setSelectedKey(null);

    window.voca?.startKeyCapture?.((key: any) => {
      console.log("Detected key:", key);
      setSelectedKey(key);
    });

    return () => {
      window.voca?.stopKeyCapture?.();
    };
  }, [step]);

  // ---- Test step: start the overlay and focus the input -------------------

  useEffect(() => {
    if (step !== "test") return;

    window.voca?.startDictationTest?.();

    const t = setTimeout(() => testInputRef.current?.focus(), 150);

    return () => clearTimeout(t);
  }, [step]);

  // ---- Actions ------------------------------------------------------------

  async function handleRequestMicrophone() {
    if (requestingMic) return;

    setRequestingMic(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      console.error("Failed to request microphone access:", error);
    } finally {
      setRequestingMic(false);
    }
  }

  async function handleSaveKey() {
    if (!selectedKey || saving) return;

    setSaving(true);

    try {
      await window.voca?.setTriggerKey?.(selectedKey.id.toString());

      setCurrentKey(selectedKey.label.toUpperCase());
      setStep("language");
    } catch (error) {
      console.error("Failed to save trigger key:", error);
    } finally {
      setSaving(false);
    }
  }

  function handleContinueWithCurrentKey() {
    setStep("language");
  }

  // One primary language (or Auto) and an optional secondary language.
  // The secondary can't be the primary, and is ignored when primary is Auto.
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
      await window.voca?.setLanguagePrefs?.(primaryLang, secondaryLang);

      setStep("design");
    } catch (error) {
      console.error("Failed to save languages:", error);
    } finally {
      setSaving(false);
    }
  }

  // Stored under the same key the notch window reads; the notch picks it up
  // live through the "storage" event.
  function chooseDesign(id: DesignId) {
    setDesign(id);

    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, id);
    } catch (error) {
      console.error("Failed to save design:", error);
    }
  }

  // The setup page itself uses the chosen font too, via --notch-font on <html>.
  function applyFontToPage(id: FontId) {
    const option = FONTS.find((f) => f.id === id);

    if (option) {
      document.documentElement.style.setProperty("--notch-font", option.cssVar);
    }
  }

  // Same pattern as the design: stored under a key the notch window reads.
  function chooseFont(id: FontId) {
    setFont(id);
    applyFontToPage(id);

    try {
      localStorage.setItem(FONT_STORAGE_KEY, id);
    } catch (error) {
      console.error("Failed to save font:", error);
    }
  }

  async function handleFinishSetup() {
    if (saving) return;

    setSaving(true);

    try {
      await window.voca?.finishSetup?.(currentKey.toLowerCase(), DEFAULT_MODEL);

      setStep("done");
    } catch (error) {
      console.error("Failed to finish setup:", error);
    } finally {
      setSaving(false);
    }
  }

  function handleCloseSetup() {
    window.voca?.closeSetupWindow?.();
  }

  // ---- Derived values -----------------------------------------------------

  const permissionsLoaded = permissionStatus !== null;
  const permissionsRequired = permissionStatus?.requiresPermissions ?? false;
  const accessibilityGranted = permissionStatus?.accessibilityGranted ?? false;
  const inputMonitoringGranted =
    permissionStatus?.inputMonitoringGranted ?? false;
  const microphoneGranted = permissionStatus?.microphoneGranted ?? false;

  const permissionItems: PermissionItem[] = [
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
      onAction: () => window.voca?.openAccessibilitySettings?.(),
    },
    {
      id: "input-monitoring",
      name: "Input Monitoring",
      desc: "Detect your trigger key",
      granted: inputMonitoringGranted,
      actionLabel: "Open Settings",
      busy: false,
      onAction: () => window.voca?.openInputMonitoringSettings?.(),
    },
  ];

  const grantedCount = permissionItems.filter((p) => p.granted).length;

  // Don't let people through before the first status check has come back
  const canContinuePastPermissions =
    permissionsLoaded &&
    (!permissionsRequired || grantedCount === permissionItems.length);

  return {
    step,
    setStep,
    loading,
    saving,

    currentKey,
    selectedKey,

    permissions: {
      loaded: permissionsLoaded,
      required: permissionsRequired,
      items: permissionItems,
      grantedCount,
      inputMonitoringGranted,
      justGranted,
      canContinue: canContinuePastPermissions,
    },

    languages: {
      options: languageOptions,
      primary: primaryLang,
      secondary: secondaryLang,
      choosePrimary,
      chooseSecondary: setSecondaryLang,
    },

    design: {
      selected: design,
      choose: chooseDesign,
    },

    font: {
      selected: font,
      choose: chooseFont,
    },

    test: {
      text: testText,
      setText: setTestText,
      inputRef: testInputRef,
    },

    actions: {
      saveKey: handleSaveKey,
      continueWithCurrentKey: handleContinueWithCurrentKey,
      continueFromLanguage: handleContinueFromLanguage,
      finishSetup: handleFinishSetup,
      closeSetup: handleCloseSetup,
    },
  };
}

export type SetupState = ReturnType<typeof useSetup>;