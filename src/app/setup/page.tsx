"use client";

import {
  ChangeKeyStep,
  CurrentKeyStep,
  DesignStep,
  DoneStep,
  FontStep,
  LanguageStep,
  LoadingCard,
  PermissionsStep,
  StepDots,
  TestStep,
  WelcomeStep,
} from "./SetupSteps";
import { useSetup } from "./useSetup";
import "./setup.css";

// Thin page: wires the setup state (useSetup) to the step components.
export default function SetupPage() {
  const s = useSetup();

  if (s.loading) {
    return <LoadingCard />;
  }

  return (
    <main className="setup-page">
      <div className="setup-card">
        {s.step !== "done" && <StepDots step={s.step} />}

        {s.step === "welcome" && (
          <WelcomeStep onNext={() => s.setStep("permissions")} />
        )}

        {s.step === "permissions" && (
          <PermissionsStep
            permissions={s.permissions}
            onBack={() => s.setStep("welcome")}
            onNext={() => s.setStep("current-key")}
          />
        )}

        {s.step === "current-key" && (
          <CurrentKeyStep
            currentKey={s.currentKey}
            saving={s.saving}
            onChangeKey={() => s.setStep("change-key")}
            onBack={() => s.setStep("permissions")}
            onNext={s.actions.continueWithCurrentKey}
          />
        )}

        {s.step === "change-key" && (
          <ChangeKeyStep
            selectedKey={s.selectedKey}
            saving={s.saving}
            onBack={() => s.setStep("current-key")}
            onSave={s.actions.saveKey}
          />
        )}

        {s.step === "language" && (
          <LanguageStep
            languages={s.languages}
            saving={s.saving}
            onBack={() => s.setStep("current-key")}
            onNext={s.actions.continueFromLanguage}
          />
        )}

        {s.step === "design" && (
          <DesignStep
            design={s.design}
            onBack={() => s.setStep("language")}
            onNext={() => s.setStep("font")}
          />
        )}

        {s.step === "font" && (
          <FontStep
            font={s.font}
            onBack={() => s.setStep("design")}
            onNext={() => s.setStep("test")}
          />
        )}

        {s.step === "test" && (
          <TestStep
            currentKey={s.currentKey}
            showLanguageSwitchHint={
              s.languages.secondary !== "none" && s.languages.primary !== "auto"
            }
            test={s.test}
            saving={s.saving}
            onBack={() => s.setStep("font")}
            onFinish={s.actions.finishSetup}
          />
        )}

        {s.step === "done" && (
          <DoneStep
            currentKey={s.currentKey}
            onClose={s.actions.closeSetup}
          />
        )}
      </div>
    </main>
  );
}