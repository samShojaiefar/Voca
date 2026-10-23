
export {};

type CapturedKey = {
  code: number;
  label: string;
} | null;

type KeyOption = {
  id: string;
  label: string;
  code?: number;
};

type ModelOption = {
  id: string;
  label: string;
};

type LanguageOption = {
  id: string;
  label: string;
};

type VoiceOSConfig = {
  triggerKey?: string;
  triggerKeyCode?: number;
  triggerKeyLabel?: string;
  model?: string;
  primaryLanguage?: string;
  secondaryLanguage?: string;
  setupComplete: boolean;
};

declare global {
  interface Window {
    voiceOS: {
      onAltState: (
        callback: (isDown: boolean) => void
      ) => void;

      getConfig: () => Promise<VoiceOSConfig>;

      getKeyOptions: () => Promise<KeyOption[]>;

      setTriggerKey: (
        keyId: string
      ) => Promise<unknown>;

      getModelOptions: () => Promise<ModelOption[]>;

      setModel: (
        modelId: string
      ) => Promise<unknown>;

      getLanguageOptions: () => Promise<LanguageOption[]>;

      setLanguagePrefs: (
        primary: string,
        secondary: string
      ) => Promise<unknown>;

      startDictationTest: () => Promise<unknown>;

      startKeyCapture: (
        callback: (key: CapturedKey) => void
      ) => () => void;

      stopKeyCapture: () => void;

      finishSetup: (
        keyId: string,
        modelId: string
      ) => Promise<boolean>;

      onTranscriptionResult: (
        callback: (text: string) => void
      ) => () => void;

      sendAudioBuffer: (
        arrayBuffer: ArrayBuffer
      ) => void;
    };
  }
}
