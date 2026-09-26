export {};

type CapturedKey = { code: number; label: string } | null;

declare global {
  interface Window {
    voiceOS: {
      onAltState: (callback: (isDown: boolean) => void) => void;
      getConfig: () => Promise<{
        triggerKeyCode: number;
        triggerKeyLabel: string;
        setupComplete: boolean;
      }>;
      startKeyCapture: () => Promise<CapturedKey>;
      cancelKeyCapture: () => Promise<void>;
      startKeyTest: (keyCode: number) => Promise<void>;
      stopKeyTest: () => Promise<void>;
      onKeyTestState: (callback: (isDown: boolean) => void) => void;
      finishSetup: (payload: {
        keyCode: number;
        keyLabel: string;
      }) => Promise<boolean>;
    };
  }
}