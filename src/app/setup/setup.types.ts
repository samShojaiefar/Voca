// Shared types, constants and pure helpers for the setup flow.
// No React in here.

export type DetectedKey = {
  id: number;
  label: string;
};
export type CapturedKey = {
  id: number;
  label: string;
};

export type ModelOption = {
  id: string;
  label: string;
  desc: string;
  installed: boolean;
};



export type LanguageOption = {
  id: string;
  label: string;
};

export interface PermissionStatus {
  platform: any;
  requiresPermissions: any;
  accessibilityGranted: any;

  // Optional because the current Electron API
  // doesn't necessarily return these yet.
  inputMonitoringGranted?: boolean;
  microphoneGranted?: boolean;
}

export type PermissionItem = {
  id: string;
  name: string;
  desc: string;
  granted: boolean;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
};

export const DEFAULT_MODEL = "ggml-tiny-q5_1.bin";

// The two notch designs people can pick from. The ids must match the theme
// ids in the notch page (THEMES) and the [data-theme] blocks in globals.css.
export type DesignId = "notch" | "island";

export const DESIGN_STORAGE_KEY = "voca-theme";
export const DEFAULT_DESIGN: DesignId = "notch";

export const DESIGNS: { id: DesignId; label: string; desc: string }[] = [
  { id: "notch", label: "Notch", desc: "Attached to the top edge" },
  { id: "island", label: "Island", desc: "A floating pill, like Dynamic Island" },
];

export function isDesignId(value: unknown): value is DesignId {
  return DESIGNS.some((d) => d.id === value);
}

// The two fonts for the text shown in the notch.
export type FontId = "pixel" | "serif";

export const FONT_STORAGE_KEY = "voca-font";
export const DEFAULT_FONT: FontId = "pixel";

export const FONTS: {
  id: FontId;
  label: string;
  desc: string;
  cssVar: string;
}[] = [
  {
    id: "pixel",
    label: "Pixel",
    desc: "Geist Pixel Square",
    cssVar: "var(--font-geist-pixel-square)",
  },
  {
    id: "serif",
    label: "Serif",
    desc: "Geist Serif Square",
    cssVar: "var(--font-geist-serif-square)",
  },
];

export function isFontId(value: unknown): value is FontId {
  return FONTS.some((f) => f.id === value);
}

export type Step =
  | "welcome"
  | "permissions"
  | "current-key"
  | "change-key"
  | "model"
  | "language"
  | "design"
  | "font"
  | "test"
  | "done";

// Steps shown in the progress dots, in order. "done" gets no dots, and
// "change-key" shares its dot with "current-key" since it's a sub-flow.
export const DOT_STEPS: Step[] = [
  "welcome",
  "permissions",
  "current-key",
  "model",
  "language",
  "design",
  "font",
  "test",
];

export function dotIndexForStep(step: Step): number {
  if (step === "change-key") {
    return DOT_STEPS.indexOf("current-key");
  }

  return DOT_STEPS.indexOf(step);
}