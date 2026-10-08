const { app, BrowserWindow, screen, ipcMain, session, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const { uIOhook, UiohookKey } = require("uiohook-napi");

// ---------------------------------------------------------------------------
// Whisper.cpp transcription config
// ---------------------------------------------------------------------------
// EDIT: in dev, this looks for a `whisper.cpp` folder next to main.js
// (electron/whisper.cpp/...). Once packaged, it looks inside the app's
// bundled resources instead — see the extraResources note further down
// and in the accompanying README for how to wire that up in
// electron-builder.yml / package.json's "build" config.
//
// IMPORTANT for distributing to other users: use the CPU-only whisper.cpp
// build (whisper-bin-x64.zip from the GitHub releases), NOT a CUDA build.
// Most end users won't have a compatible NVIDIA GPU/CUDA install, and a
// CUDA-only binary will fail to even start for them. CPU-only runs on
// every Windows machine, just somewhat slower.
//
// Audio recording happens entirely in the renderer via the browser's own
// getUserMedia API (Electron is Chromium under the hood) — no sox, no mic
// npm package, no external recording binary. Whisper.cpp is used ONLY to
// transcribe the WAV file the renderer hands back.

const WHISPER_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "whisper.cpp")
  : path.join(__dirname, "whisper.cpp");

const exeName = process.platform === "win32" ? ".exe" : "";

// The exact folder layout varies depending on how whisper.cpp was built
// (a straight `cmake --build build` vs. Visual Studio's Release/Debug
// subfolders) and older releases name the binary `main` instead of
// `whisper-cli`. Try the common locations and use whichever exists.
const WHISPER_BIN_CANDIDATES = [
  path.join(WHISPER_DIR, "build", "bin", `whisper-cli${exeName}`),
  path.join(WHISPER_DIR, "build", "bin", "Release", `whisper-cli${exeName}`),
  path.join(WHISPER_DIR, "build", "bin", "Debug", `whisper-cli${exeName}`),
  path.join(WHISPER_DIR, "build", "bin", `main${exeName}`),
  path.join(WHISPER_DIR, "build", "bin", "Release", `main${exeName}`),
  path.join(WHISPER_DIR, `whisper-cli${exeName}`),
  path.join(WHISPER_DIR, `main${exeName}`),
];

function resolveWhisperBinPath() {
  for (const candidate of WHISPER_BIN_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Nothing found — fall back to the first candidate so the ENOENT error
  // at least points somewhere sensible, and log every path we tried.
  console.error(
    "[Voca] Could not find a whisper.cpp binary. Looked in:\n" +
      WHISPER_BIN_CANDIDATES.map((p) => "  - " + p).join("\n")
  );

  return WHISPER_BIN_CANDIDATES[0];
}

const WHISPER_BIN_PATH = resolveWhisperBinPath();


// ---------------------------------------------------------------------------
// Whisper model options (user picks one during setup)
// ---------------------------------------------------------------------------

const MODEL_OPTIONS = [
  {
    id: "ggml-tiny-q5_1.bin",
    label: "Tiny (q5_1)",
    desc: "Fastest, lowest accuracy",
  },
  {
    id: "ggml-base-q5_1.bin",
    label: "Base (q5_1)",
    desc: "Balanced speed and accuracy",
  },
  {
    id: "ggml-small.bin",
    label: "Small",
    desc: "Most accurate, slowest on CPU",
  },
];

const DEFAULT_MODEL = "ggml-tiny-q5_1.bin";

// ---------------------------------------------------------------------------
// Languages: a primary language and an optional secondary one.
//   - primary "auto": whisper detects the language itself (secondary ignored)
//   - primary only: that language is forced (fastest, most accurate)
//   - primary + secondary: no detection at all. One of the two is "active"
//     and forced; the Ctrl+Shift+L hotkey switches between them.
// ---------------------------------------------------------------------------

// Hotkey that switches between the primary and secondary language.
const LANGUAGE_SWITCH_KEY = UiohookKey.L; // used together with Ctrl + Shift

const LANGUAGE_OPTIONS = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English" },
  { id: "fa", label: "Persian" },
  { id: "ar", label: "Arabic" },
  { id: "tr", label: "Turkish" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "ru", label: "Russian" },
  { id: "uk", label: "Ukrainian" },
  { id: "pl", label: "Polish" },
  { id: "nl", label: "Dutch" },
  { id: "hi", label: "Hindi" },
  { id: "ur", label: "Urdu" },
  { id: "zh", label: "Chinese" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "he", label: "Hebrew" },
  { id: "id", label: "Indonesian" },
];

function isValidLanguageId(id) {
  return LANGUAGE_OPTIONS.some((l) => l.id === id);
}

function getLanguagePrefs() {
  const primary = isValidLanguageId(config.primaryLanguage)
    ? config.primaryLanguage
    : "auto";

  const secondary =
    primary !== "auto" &&
    config.secondaryLanguage &&
    config.secondaryLanguage !== "none" &&
    config.secondaryLanguage !== "auto" &&
    config.secondaryLanguage !== primary &&
    isValidLanguageId(config.secondaryLanguage)
      ? config.secondaryLanguage
      : null;

  return { primary, secondary };
}

// The language whisper is forced to right now.
function getActiveLanguage() {
  const { primary, secondary } = getLanguagePrefs();

  return secondary && config.activeLanguage === "secondary"
    ? secondary
    : primary;
}

function getLanguageLabel(id) {
  return LANGUAGE_OPTIONS.find((l) => l.id === id)?.label || id;
}

function switchLanguage() {
  const { secondary } = getLanguagePrefs();

  let message;

  if (!secondary) {
    message = "No secondary language set";
  } else {
    config.activeLanguage =
      config.activeLanguage === "secondary" ? "primary" : "secondary";
    saveConfig(config);

    message = `Language: ${getLanguageLabel(getActiveLanguage())}`;
  }

  console.log(`[Voca] ${message}`);

  // Reuse the notch's result bubble as a short on-screen confirmation.
  if (notchWin && !notchWin.isDestroyed()) {
    notchWin.webContents.send("transcription-result", message);
  }
}

function isValidModelId(id) {
  return MODEL_OPTIONS.some((m) => m.id === id);
}

function getModelPath() {
  const id = isValidModelId(config.model) ? config.model : DEFAULT_MODEL;
  const modelPath = path.join(WHISPER_DIR, "models", id);

  if (!fs.existsSync(modelPath)) {
    console.error("[Voca] Whisper model not found at:", modelPath);
  }

  return modelPath;
}

process.on("uncaughtException", (err) => {
  console.error("[Voca] Uncaught exception:", err);
});

// ---------------------------------------------------------------------------
// Fixed key options
// ---------------------------------------------------------------------------

const KEY_OPTIONS = [
  {
    id: "alt",
    label: "Alt",
    codes: [UiohookKey.Alt, UiohookKey.AltRight],
  },
  {
    id: "ctrl",
    label: "Ctrl",
    codes: [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  },
  {
    id: "shift",
    label: "Shift",
    codes: [UiohookKey.Shift, UiohookKey.ShiftRight],
  },
  {
    id: "meta",
    label: process.platform === "darwin" ? "Cmd" : "Win",
    codes: [UiohookKey.Meta, UiohookKey.MetaRight],
  },
  {
    id: "capslock",
    label: "Caps Lock",
    codes: [UiohookKey.CapsLock],
  },
  {
    id: "tab",
    label: "Tab",
    codes: [UiohookKey.Tab],
  },
  // NEW: hold two keys together
  {
    id: "alt+shift",
    label: "Alt + Shift",
    codes: [
      UiohookKey.Alt,
      UiohookKey.AltRight,
      UiohookKey.Shift,
      UiohookKey.ShiftRight,
    ],
  },
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  triggerKey: "alt",
  model: DEFAULT_MODEL,
  primaryLanguage: "auto",
  secondaryLanguage: "none",
  activeLanguage: "primary",
  setupComplete: false,
};

const CONFIG_PATH = path.join(
  app.getPath("userData"),
  "voca-config.json"
);

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");

    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(raw),
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
    };
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), {
      recursive: true,
    });

    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify(cfg, null, 2)
    );
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

let config = loadConfig();

let notchWin = null;
let setupWin = null;

// ---------------------------------------------------------------------------
// Dynamic key support
// ---------------------------------------------------------------------------

function getKeyCodes(keyId) {
  // NEW: combo such as "alt+shift" or "keycode:56+keycode:42" —
  // returns every key code that belongs to the combo.
  if (keyId.includes("+")) {
    return [...new Set(getKeyGroups(keyId).flat())];
  }

  // Dynamically detected key
  if (keyId.startsWith("keycode:")) {
    const code = Number(keyId.replace("keycode:", ""));

    if (!Number.isNaN(code)) {
      return [code];
    }
  }

  // Normal predefined key
  const opt = KEY_OPTIONS.find(
    (key) => key.id === keyId
  );

  return opt
    ? opt.codes
    : KEY_OPTIONS[0].codes;
}

// ---------------------------------------------------------------------------
// NEW: combo support (e.g. hold Alt + Shift together)
// A trigger is a list of "groups". The trigger is held when at least one key
// from EVERY group is down. A single key is just one group; Alt + Shift is
// two groups: [Alt, AltRight] and [Shift, ShiftRight].
// ---------------------------------------------------------------------------

const MODIFIER_PAIRS = [
  [UiohookKey.Alt, UiohookKey.AltRight],
  [UiohookKey.Ctrl, UiohookKey.CtrlRight],
  [UiohookKey.Shift, UiohookKey.ShiftRight],
  [UiohookKey.Meta, UiohookKey.MetaRight],
];

// Make a combo work with either the left or right modifier key.
function withModifierSiblings(codes) {
  const out = new Set(codes);

  for (const pair of MODIFIER_PAIRS) {
    if (codes.some((c) => pair.includes(c))) {
      pair.forEach((c) => out.add(c));
    }
  }

  return [...out];
}

function getKeyGroups(keyId) {
  const parts = keyId.split("+");

  return parts.map((part) => {
    const codes = getKeyCodes(part);

    return parts.length > 1 ? withModifierSiblings(codes) : codes;
  });
}

function isValidKeyId(keyId) {
  if (typeof keyId !== "string" || !keyId) return false;

  return keyId.split("+").every((part) =>
    part.startsWith("keycode:")
      ? !Number.isNaN(Number(part.replace("keycode:", "")))
      : KEY_OPTIONS.some((key) => key.id === part)
  );
}

// Keys that are physically down right now (updated by the global hook).
const pressedKeys = new Set();

function isTriggerHeld() {
  return activeKeyGroups.every((group) =>
    group.some((code) => pressedKeys.has(code))
  );
}

let activeKeyCodes = getKeyCodes(
  config.triggerKey
);

let activeKeyGroups = getKeyGroups(
  config.triggerKey
);

// ---------------------------------------------------------------------------
// Convert uIOhook keycode → readable name
// ---------------------------------------------------------------------------

function getKeyLabel(keycode) {
  const specialLabels = {
    [UiohookKey.Alt]: "Alt",
    [UiohookKey.AltRight]: "Right Alt",
    [UiohookKey.Ctrl]: "Ctrl",
    [UiohookKey.CtrlRight]: "Right Ctrl",
    [UiohookKey.Shift]: "Shift",
    [UiohookKey.ShiftRight]: "Right Shift",
    [UiohookKey.Meta]: "Windows",
    [UiohookKey.MetaRight]: "Right Windows",
    [UiohookKey.Space]: "Space",
    [UiohookKey.Enter]: "Enter",
    [UiohookKey.Esc]: "Escape",
    [UiohookKey.Tab]: "Tab",
    [UiohookKey.Backspace]: "Backspace",
    [UiohookKey.CapsLock]: "Caps Lock",
    [UiohookKey.Delete]: "Delete",
    [UiohookKey.Home]: "Home",
    [UiohookKey.End]: "End",
    [UiohookKey.PageUp]: "Page Up",
    [UiohookKey.PageDown]: "Page Down",
    [UiohookKey.UpArrow]: "Arrow Up",
    [UiohookKey.DownArrow]: "Arrow Down",
    [UiohookKey.LeftArrow]: "Arrow Left",
    [UiohookKey.RightArrow]: "Arrow Right",
  };

  if (specialLabels[keycode]) {
    return specialLabels[keycode];
  }

  // F1-F12
  const functionKeys = {
    [UiohookKey.F1]: "F1",
    [UiohookKey.F2]: "F2",
    [UiohookKey.F3]: "F3",
    [UiohookKey.F4]: "F4",
    [UiohookKey.F5]: "F5",
    [UiohookKey.F6]: "F6",
    [UiohookKey.F7]: "F7",
    [UiohookKey.F8]: "F8",
    [UiohookKey.F9]: "F9",
    [UiohookKey.F10]: "F10",
    [UiohookKey.F11]: "F11",
    [UiohookKey.F12]: "F12",
  };

  if (functionKeys[keycode]) {
    return functionKeys[keycode];
  }

  // Try to find the enum name automatically
  for (const [name, value] of Object.entries(UiohookKey)) {
    if (value === keycode) {
      return name
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ");
    }
  }

  return `Key ${keycode}`;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createNotchWindow() {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;

  const windowWidth = 320;
  // Just enough to comfortably fit the expanded bar (40px) plus a little
  // breathing room — text now renders inside the bar itself, not a
  // separate panel below it, so we don't need the extra height anymore.
  const windowHeight = 60;

  notchWin = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,

    x: Math.round(
      (width - windowWidth) / 2
    ),

    y: 0,

    frame: false,
    transparent: true,
    resizable: false,

    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,

    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.js"
      ),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  notchWin.setAlwaysOnTop(
    true,
    "floating"
  );

  // The notch has no buttons or interactive elements — it's a pure
  // overlay — so make it click-through everywhere. This also means the
  // extra transparent space added for the transcript panel never blocks
  // clicks on whatever app is underneath it.
  notchWin.setIgnoreMouseEvents(true);

  notchWin.loadURL(
    "http://localhost:3000"
  );

  notchWin.on("closed", () => {
    notchWin = null;
  });
}

function createSetupWindow() {
  setupWin = new BrowserWindow({
    width: 800,
    height: 700,

    resizable: false,
    frame: true,
    center: true,

    title: "Set up Voca",

    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.js"
      ),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWin.loadURL(
    "http://localhost:3000/setup"
  );

  setupWin.on("closed", () => {
    setupWin = null;

    // The notch may already exist (created for the test step), so
    // quit whenever setup was closed without being finished.
    if (!config.setupComplete) {
      app.quit();
    }
  });
}

// ---------------------------------------------------------------------------
// Complete setup
// ---------------------------------------------------------------------------

function completeSetupAndLaunchNotch(
  keyId,
  modelId
) {
  if (modelId && isValidModelId(modelId)) {
    config.model = modelId;
  }

  // NEW: only accept ids we understand. The setup page sends a display
  // label (e.g. "right alt") here, which used to silently overwrite a
  // captured key and fall back to Alt.
  if (keyId && isValidKeyId(keyId)) {
    config.triggerKey = keyId;

    activeKeyCodes =
      getKeyCodes(keyId);

    activeKeyGroups =
      getKeyGroups(keyId);
  }

  config.setupComplete = true;

  saveConfig(config);

  if (
    setupWin &&
    !setupWin.isDestroyed()
  ) {
    setupWin.close();
  }

  if (!notchWin) {
    createNotchWindow();
  }
}

// ---------------------------------------------------------------------------
// KEY CAPTURE MODE
// ---------------------------------------------------------------------------

let keyCaptureActive = false;
let keyCaptureWindow = null;
let captureKeys = []; // NEW: every key held during capture (supports combos)

function startKeyCapture(window) {
  keyCaptureActive = true;
  keyCaptureWindow = window;
  captureKeys = [];

  console.log(
    "[Voca] Key capture started"
  );
}

function stopKeyCapture() {
  keyCaptureActive = false;
  keyCaptureWindow = null;

  console.log(
    "[Voca] Key capture stopped"
  );
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function setupIpc() {
  ipcMain.handle(
    "get-key-options",
    () =>
      KEY_OPTIONS.map(
        ({ id, label }) => ({
          id,
          label,
        })
      )
  );

  ipcMain.handle(
    "get-config",
    () => config
  );

  ipcMain.handle(
    "get-model-options",
    () =>
      MODEL_OPTIONS.map((m) => ({
        ...m,
        installed: fs.existsSync(
          path.join(WHISPER_DIR, "models", m.id)
        ),
      }))
  );

  // The notch window (mic capture + overlay) normally only exists after
  // setup finishes. The test step needs it earlier so dictation works.
  ipcMain.handle(
    "start-dictation-test",
    () => {
      if (!notchWin || notchWin.isDestroyed()) {
        createNotchWindow();
      }

      return true;
    }
  );

  ipcMain.handle(
    "get-language-options",
    () => LANGUAGE_OPTIONS
  );

  ipcMain.handle(
    "set-language-prefs",
    (_event, primary, secondary) => {
      config.primaryLanguage = isValidLanguageId(primary) ? primary : "auto";
      config.secondaryLanguage =
        isValidLanguageId(secondary) && secondary !== "auto"
          ? secondary
          : "none";

      config.activeLanguage = "primary";

      saveConfig(config);

      return config;
    }
  );

  ipcMain.handle(
    "set-model",
    (_event, modelId) => {
      if (!isValidModelId(modelId)) return config;

      config.model = modelId;
      saveConfig(config);

      return config;
    }
  );

  ipcMain.handle(
    "set-trigger-key",
    (_event, keyId) => {
      config.triggerKey = keyId;

      activeKeyCodes =
        getKeyCodes(keyId);

      activeKeyGroups =
        getKeyGroups(keyId);

      saveConfig(config);

      return config;
    }
  );

  // ---------------------------------------------------------
  // Start listening for a new trigger key
  // ---------------------------------------------------------

  ipcMain.on(
    "start-key-capture",
    (event) => {
      startKeyCapture(
        event.sender
      );
    }
  );

  // ---------------------------------------------------------
  // Stop listening for a new trigger key
  // ---------------------------------------------------------

  ipcMain.on(
    "stop-key-capture",
    () => {
      stopKeyCapture();
    }
  );

  // ---------------------------------------------------------
  // Finish setup
  // ---------------------------------------------------------

  ipcMain.handle(
    "finish-setup",
    (_event, keyId, modelId) => {
      stopKeyCapture();

      completeSetupAndLaunchNotch(
        keyId,
        modelId
      );

      return true;
    }
  );

  // ---------------------------------------------------------
  // NEW: audio recorded in the renderer (already a WAV,
  // 16kHz mono) — hand it to whisper.cpp for transcription.
  // ---------------------------------------------------------

  ipcMain.on(
    "audio-recorded",
    (_event, wavData) => {
      const buffer = Buffer.isBuffer(wavData)
        ? wavData
        : Buffer.from(wavData);

      if (buffer.length === 0) {
        console.log(
          "[Voca] No audio captured, skipping transcription"
        );
        return;
      }

      const tmpPath = path.join(
        os.tmpdir(),
        `voca-${Date.now()}.wav`
      );

      fs.writeFileSync(tmpPath, buffer);

      transcribeAudio(tmpPath);
    }
  );
}

// ---------------------------------------------------------------------------
// NEW: Write the transcript into whatever input is currently focused
// (browser, Word, Notepad, VS Code...). The notch window is created with
// focusable:false, so focus never leaves the user's app — we just put the
// text on the clipboard and simulate Ctrl+V / Cmd+V. Clipboard paste is
// used instead of simulated key-by-key typing because it is instant and
// handles Persian / Unicode / emoji correctly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NEW: spoken emoji. Say "emoji" + a name from the list below and the
// transcript gets the emoji instead:
//     "hello, emoji heart"  ->  "hello, ❤️"
// Names are matched case-insensitively and the longest name wins, so
// "emoji broken heart" gives 💔 and not ❤️. To add your own, just add a
// line:  "your name": "😀",
// ---------------------------------------------------------------------------

const EMOJI_LIST = {
  // --- faces ---
  "smile": "😊", "happy": "😊", "smiley": "😃", "big smile": "😄",
  "grin": "😁", "laugh": "😂", "laughing": "😂", "joy": "😂", "lol": "😂",
  "rofl": "🤣", "wink": "😉", "cool": "😎", "sunglasses": "😎",
  "heart eyes": "😍", "in love": "😍", "kiss": "😘", "kissing": "😘",
  "cry": "😢", "sad": "😢", "crying": "😭", "sob": "😭",
  "angry": "😠", "mad": "😡", "think": "🤔", "thinking": "🤔",
  "surprised": "😮", "shocked": "😱", "scream": "😱",
  "sleepy": "😴", "sleep": "😴", "tired": "😫", "sick": "🤒",
  "nerd": "🤓", "party face": "🥳", "hug": "🤗", "shy": "😳",
  "embarrassed": "😳", "confused": "😕", "neutral": "😐",
  "silly": "🤪", "crazy": "🤪", "tongue": "😛", "sweat": "😅",
  "relieved": "😌", "pleading": "🥺", "skull": "💀", "ghost": "👻",
  "clown": "🤡", "poop": "💩", "devil": "😈", "angel": "😇",
  "robot": "🤖", "alien": "👽", "monkey": "🐵",

  // --- hearts ---
  "heart": "❤️", "red heart": "❤️", "love": "❤️", "broken heart": "💔",
  "blue heart": "💙", "green heart": "💚", "yellow heart": "💛",
  "purple heart": "💜", "black heart": "🖤", "white heart": "🤍",
  "orange heart": "🧡", "pink heart": "🩷", "sparkling heart": "💖",
  "two hearts": "💕", "kiss mark": "💋",

  // --- hands & gestures ---
  "thumbs up": "👍", "like": "👍", "thumbs down": "👎", "dislike": "👎",
  "ok": "👌", "okay": "👌", "clap": "👏", "applause": "👏",
  "pray": "🙏", "thanks": "🙏", "thank you": "🙏", "please": "🙏",
  "folded hands": "🙏", "wave": "👋", "muscle": "💪", "strong": "💪",
  "fist": "✊", "peace": "✌️", "victory": "✌️",
  "crossed fingers": "🤞", "fingers crossed": "🤞",
  "point up": "☝️", "point right": "👉", "point left": "👈",
  "point down": "👇", "raised hands": "🙌", "handshake": "🤝",
  "writing hand": "✍️", "eyes": "👀", "brain": "🧠",

  // --- symbols ---
  "fire": "🔥", "star": "⭐", "sparkles": "✨", "hundred": "💯",
  "100": "💯", "check": "✅", "check mark": "✅", "cross": "❌", "x": "❌",
  "warning": "⚠️", "question": "❓", "exclamation": "❗",
  "lightning": "⚡", "zap": "⚡", "boom": "💥", "idea": "💡",
  "light bulb": "💡", "bomb": "💣", "rocket": "🚀",
  "party popper": "🎉", "confetti": "🎉", "party": "🎉",
  "celebration": "🎉", "gift": "🎁", "trophy": "🏆", "medal": "🏅",
  "crown": "👑", "money": "💰", "dollar": "💵", "diamond": "💎",
  "lock": "🔒", "key": "🔑", "bell": "🔔", "pin": "📌",
  "clock": "⏰", "hourglass": "⌛", "calendar": "📅",

  // --- objects ---
  "phone": "📱", "computer": "💻", "laptop": "💻", "email": "📧",
  "mail": "✉️", "book": "📖", "pencil": "✏️", "memo": "📝",
  "folder": "📁", "camera": "📷", "video camera": "🎥",
  "music": "🎵", "microphone": "🎤", "headphones": "🎧",
  "game": "🎮", "tv": "📺", "car": "🚗", "plane": "✈️",
  "ship": "🚢", "bike": "🚲", "house": "🏠",

  // --- nature & weather ---
  "earth": "🌍", "world": "🌍", "sun": "☀️", "moon": "🌙",
  "cloud": "☁️", "rain": "🌧️", "snow": "❄️", "snowflake": "❄️",
  "rainbow": "🌈", "umbrella": "☔", "ocean": "🌊", "water wave": "🌊",
  "rose": "🌹", "flower": "🌸", "sunflower": "🌻", "tree": "🌳",
  "plant": "🌱", "cactus": "🌵",

  // --- food & drink ---
  "pizza": "🍕", "burger": "🍔", "fries": "🍟", "cake": "🎂",
  "coffee": "☕", "tea": "🍵", "beer": "🍺", "wine": "🍷",
  "apple": "🍎", "banana": "🍌", "strawberry": "🍓",
  "watermelon": "🍉", "cookie": "🍪", "ice cream": "🍦",
  "popcorn": "🍿", "taco": "🌮", "egg": "🥚", "bread": "🍞",

  // --- animals ---
  "dog": "🐶", "cat": "🐱", "lion": "🦁", "tiger": "🐯", "bear": "🐻",
  "panda": "🐼", "rabbit": "🐰", "mouse": "🐭", "cow": "🐮", "pig": "🐷",
  "frog": "🐸", "fish": "🐟", "bird": "🐦", "butterfly": "🦋",
  "bee": "🐝", "unicorn": "🦄", "snake": "🐍", "turtle": "🐢",
  "penguin": "🐧", "horse": "🐴", "elephant": "🐘", "chicken": "🐔",

  // --- sports ---
  "football": "⚽", "soccer": "⚽", "basketball": "🏀",
};

// Built once: "emoji" (or "emojis") + optional filler + a name from the list.
// Whisper adds its own punctuation, so commas / periods around the name
// are tolerated and a trailing "." or "," is swallowed with the emoji.
const EMOJI_REGEX = (() => {
  const names = Object.keys(EMOJI_LIST)
    .sort((a, b) => b.length - a.length)
    .map((name) =>
      name
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/ /g, "[\\s-]+")
    );

  return new RegExp(
    "\\bemojis?[\\s,.:;!-]+" +
      "(?:(?:of\\s+)?(?:a|an|the)\\s+)?" +
      "(" + names.join("|") + ")\\b[.,]?",
    "gi"
  );
})();

function applyEmojiCommands(text) {
  return text.replace(EMOJI_REGEX, (match, name) => {
    const key = name.toLowerCase().replace(/[\s-]+/g, " ");

    return EMOJI_LIST[key] || match;
  });
}

// NEW: true while Voca itself is injecting keystrokes (paste / menu mask).
// The global hook below ignores those synthetic events, otherwise a
// trigger such as Ctrl would "press itself" and start a recording.
let isInjecting = false;

// NEW (Windows): tapping Alt (or Win) alone and releasing it makes Windows
// activate the target app's menu bar (or the Start menu). By the time
// whisper finishes, that menu mode would swallow our Ctrl+V. Tapping Ctrl
// while the trigger is held "uses up" the key press so the menu never opens.
function maskMenuActivation() {
  if (process.platform !== "win32") return;
  if (typeof uIOhook.keyTap !== "function") return;

  const menuKeys = [
    UiohookKey.Alt,
    UiohookKey.AltRight,
    UiohookKey.Meta,
    UiohookKey.MetaRight,
  ];

  if (!activeKeyCodes.some((code) => menuKeys.includes(code))) return;

  isInjecting = true;

  try {
    uIOhook.keyTap(UiohookKey.Ctrl);
  } catch (err) {
    console.error("[Voca] Menu mask failed:", err);
  }

  setTimeout(() => {
    isInjecting = false;
  }, 120);
}

// NEW: put the user's original clipboard back. Never throws — a failed
// restore must not become an uncaught exception.
function restoreClipboard(text, image) {
  try {
    if (typeof text === "string" && text) {
      clipboard.writeText(text);
    } else if (image) {
      clipboard.writeImage(image);
    } else {
      clipboard.clear();
    }
  } catch (err) {
    console.error("[Voca] Could not restore clipboard:", err);
  }
}

function typeIntoActiveApp(text) {
  // Whisper prints markers like [BLANK_AUDIO] when it hears nothing.
  const cleaned = text
    .replace(/\[[A-Z_ ]+\]/g, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();

  if (!cleaned) return;

  // Trailing space so two dictations in a row don't glue together.
  const toPaste = cleaned + " ";

  // NEW: safe snapshot of the user's clipboard. readText() is not
  // guaranteed to hand back a plain string (that caused the
  // "Error processing argument at index 0" crash when restoring), so
  // validate it, and keep an image if the clipboard held one instead.
  let previousClipboard = "";
  let previousImage = null;

  try {
    const t = clipboard.readText();
    previousClipboard = typeof t === "string" ? t : "";

    if (!previousClipboard) {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) previousImage = img;
    }
  } catch (err) {
    console.error("[Voca] Could not read clipboard:", err);
  }
  clipboard.writeText(toPaste);

  // NEW (preferred): send Ctrl+V / Cmd+V with uiohook-napi itself. It is
  // instant (no PowerShell / osascript / xdotool process to start) and
  // needs no extra dependency. The spawn() code below is kept as a
  // fallback for older uiohook-napi versions that have no keyTap().
  if (typeof uIOhook.keyTap === "function") {
    const pasteModifier =
      process.platform === "darwin" ? UiohookKey.Meta : UiohookKey.Ctrl;

    setTimeout(() => {
      isInjecting = true;

      try {
        uIOhook.keyTap(UiohookKey.V, [pasteModifier]);
      } catch (err) {
        console.error("[Voca] keyTap paste failed:", err);
      }

      setTimeout(() => {
        isInjecting = false;
      }, 250);

      // Let the target app read the clipboard, then restore the old one.
      setTimeout(() => {
        restoreClipboard(previousClipboard, previousImage);
      }, 800);
    }, 60);

    return;
  }

  let pasteProc;

  try {
    if (process.platform === "win32") {
      pasteProc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle", "Hidden",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; " +
            "[System.Windows.Forms.SendKeys]::SendWait('^v')",
        ],
        { windowsHide: true }
      );
    } else if (process.platform === "darwin") {
      // Needs Accessibility permission for the app (System Settings →
      // Privacy & Security → Accessibility).
      pasteProc = spawn("osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);
    } else {
      // Linux (X11): requires `xdotool` to be installed.
      pasteProc = spawn("xdotool", ["key", "ctrl+v"]);
    }
  } catch (err) {
    console.error("[Voca] Failed to simulate paste:", err);
    return;
  }

  pasteProc.on("error", (err) => {
    console.error("[Voca] Paste helper error:", err);
  });

  pasteProc.on("close", () => {
    // Give the target app a moment to read the clipboard, then put the
    // user's original clipboard content back.
    setTimeout(() => {
      restoreClipboard(previousClipboard, previousImage);
    }, 300);
  });
}

// ---------------------------------------------------------------------------
// Whisper transcription (transcription only — no recording here)
// ---------------------------------------------------------------------------

function transcribeAudio(wavPath) {
  runWhisper(wavPath, getActiveLanguage());
}

function runWhisper(wavPath, lang) {
  const startedAt = Date.now();

  console.log(`[Voca] Transcribing with Whisper (language: ${lang})...`);

  const args = [
    "-m", getModelPath(),
    "-f", wavPath,
    "-nt", // no timestamps, plain text only
    "-l", lang,
  ];

  let proc;

  try {
    proc = spawn(WHISPER_BIN_PATH, args);
  } catch (err) {
    console.error("[Voca] Failed to spawn whisper binary:", err);
    console.error("[Voca] Check WHISPER_BIN_PATH in main.js:", WHISPER_BIN_PATH);
    fs.unlink(wavPath, () => {});
    return;
  }

  // Small/base models can take well over a minute on CPU, especially on
  // the first run. Log a heartbeat every 5s so it's obvious the process
  // is still alive and working rather than frozen.
  const heartbeat = setInterval(() => {
    console.log(
      `[Voca] ...still transcribing (${(
        (Date.now() - startedAt) /
        1000
      ).toFixed(1)}s elapsed)`
    );
  }, 5000);

  let output = "";
  let errOutput = "";

  proc.stdout.on("data", (data) => {
    output += data.toString();
  });

  proc.stderr.on("data", (data) => {
    errOutput += data.toString();
  });

  proc.on("close", (code) => {
    clearInterval(heartbeat);
    fs.unlink(wavPath, () => {});

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (code !== 0) {
      console.error(`[Voca] Whisper exited with code ${code} after ${elapsed}s`);
      console.error(errOutput);
      return;
    }

    const rawText = output.trim();

    // NEW: turn spoken "emoji heart" into ❤️ before showing / pasting it.
    const text = applyEmojiCommands(rawText);

    if (text !== rawText) {
      console.log("[Voca] Raw transcript (before emoji):", rawText);
    }

    console.log(`[Voca] Transcript (${elapsed}s):`, text);

    if (notchWin && !notchWin.isDestroyed()) {
      notchWin.webContents.send("transcription-result", text);
    }

    // NEW: also write the text into the currently focused input.
    if (text) {
      typeIntoActiveApp(text);
    }
  });

  proc.on("error", (err) => {
    clearInterval(heartbeat);
    console.error("[Voca] Whisper process error:", err);
    console.error("[Voca] Check WHISPER_BIN_PATH in main.js:", WHISPER_BIN_PATH);
  });
}

// ---------------------------------------------------------------------------
// Global keyboard hook
// ---------------------------------------------------------------------------

let altHoldTimer = null;
let keyIsDown = false;
let languageSwitchHeld = false;

function setupKeyboard() {
  // ---------------------------------------------------------
  // KEY DOWN
  // ---------------------------------------------------------

  uIOhook.on(
    "keydown",
    (event) => {
      // NEW: ignore keys that Voca injected itself
      if (isInjecting) return;

      // -----------------------------------------------------
      // SETUP KEY CAPTURE MODE
      // -----------------------------------------------------

      // NEW: remember which keys are physically held (needed for combos)
      pressedKeys.add(event.keycode);

      if (keyCaptureActive) {
        // NEW: collect every key held during capture. The result is sent
        // on key RELEASE (see keyup below) so a combo like Alt + Shift
        // can be detected as one trigger.
        if (!captureKeys.includes(event.keycode)) {
          captureKeys.push(event.keycode);
        }

        return;
      }

      // -----------------------------------------------------
      // LANGUAGE SWITCH HOTKEY (Ctrl + Shift + L)
      // -----------------------------------------------------

      if (
        event.keycode === LANGUAGE_SWITCH_KEY &&
        (pressedKeys.has(UiohookKey.Ctrl) ||
          pressedKeys.has(UiohookKey.CtrlRight)) &&
        (pressedKeys.has(UiohookKey.Shift) ||
          pressedKeys.has(UiohookKey.ShiftRight))
      ) {
        if (!languageSwitchHeld) {
          languageSwitchHeld = true;
          switchLanguage();
        }

        return;
      }

      // -----------------------------------------------------
      // NORMAL VOCAL TRIGGER
      // -----------------------------------------------------

      if (
        !activeKeyCodes.includes(
          event.keycode
        )
      ) {
        return;
      }

      // Ignore repeated keydown events
      if (keyIsDown) {
        return;
      }

      // NEW: for a combo (e.g. Alt + Shift) wait until every key is held
      if (!isTriggerHeld()) {
        return;
      }

      keyIsDown = true;

      altHoldTimer = setTimeout(() => {
        if (
          keyIsDown &&
          notchWin &&
          !notchWin.isDestroyed()
        ) {
          // NEW: stop Alt / Win from opening the target app's menu
          maskMenuActivation();

          // Renderer listens for this and starts capturing
          // mic audio via getUserMedia.
          notchWin.webContents.send(
            "alt-state",
            true
          );
        }
      }, 100);
    }
  );

  // ---------------------------------------------------------
  // KEY UP
  // ---------------------------------------------------------

  uIOhook.on(
    "keyup",
    (event) => {
      // NEW: ignore keys that Voca injected itself
      if (isInjecting) return;

      // NEW: forget the released key
      pressedKeys.delete(event.keycode);

      if (event.keycode === LANGUAGE_SWITCH_KEY) {
        languageSwitchHeld = false;
      }

      // NEW: finish key capture (single key or combo) on release
      if (
        keyCaptureActive &&
        keyCaptureWindow &&
        captureKeys.length > 0
      ) {
        const keyId = captureKeys
          .map((code) => `keycode:${code}`)
          .join("+");
        const label = captureKeys.map(getKeyLabel).join(" + ");

        keyCaptureWindow.send("key-detected", {
          id: keyId,
          label: label,
        });

        // Only detect one key / combo
        captureKeys = [];
        keyCaptureActive = false;

        return;
      }

      if (
        !activeKeyCodes.includes(
          event.keycode
        )
      ) {
        return;
      }

      // NEW: only react if the trigger (single key or the full combo)
      // was actually active
      if (!keyIsDown) {
        return;
      }

      keyIsDown = false;

      if (altHoldTimer) {
        clearTimeout(
          altHoldTimer
        );

        altHoldTimer = null;
      }

      if (
        notchWin &&
        !notchWin.isDestroyed()
      ) {
        // Renderer listens for this, stops capturing, encodes
        // the WAV and sends it back via "audio-recorded".
        notchWin.webContents.send(
          "alt-state",
          false
        );
      }
    }
  );

  uIOhook.start();

  console.log(
    "[Voca] Global keyboard hook started"
  );
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  // Auto-grant mic access to our own windows so no OS-level
  // Chromium permission prompt has to appear (the notch window
  // is non-focusable and can't be clicked to dismiss one).
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media");
    }
  );

  setupIpc();
  setupKeyboard();
  createSetupWindow();
});

app.on("will-quit", () => {
  uIOhook.stop();
});

app.on(
  "window-all-closed",
  (event) => {
    if (config.setupComplete) {
      event.preventDefault();
    }
  }
);