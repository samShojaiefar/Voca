const { app, BrowserWindow, screen, ipcMain, session } = require("electron");
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


const WHISPER_MODEL_PATH = path.join(
  WHISPER_DIR,
  "models",
  "ggml-small.bin"
);

if (!fs.existsSync(WHISPER_MODEL_PATH)) {
  console.error(
    "[Voca] Whisper model not found at:",
    WHISPER_MODEL_PATH
  );
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
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  triggerKey: "alt",
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

let activeKeyCodes = getKeyCodes(
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
    height: 660,

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

    if (
      !config.setupComplete &&
      !notchWin
    ) {
      app.quit();
    }
  });
}

// ---------------------------------------------------------------------------
// Complete setup
// ---------------------------------------------------------------------------

function completeSetupAndLaunchNotch(
  keyId
) {
  if (keyId) {
    config.triggerKey = keyId;

    activeKeyCodes =
      getKeyCodes(keyId);
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

function startKeyCapture(window) {
  keyCaptureActive = true;
  keyCaptureWindow = window;

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
    "set-trigger-key",
    (_event, keyId) => {
      config.triggerKey = keyId;

      activeKeyCodes =
        getKeyCodes(keyId);

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
    (_event, keyId) => {
      stopKeyCapture();

      completeSetupAndLaunchNotch(
        keyId
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
// Whisper transcription (transcription only — no recording here)
// ---------------------------------------------------------------------------

function transcribeAudio(wavPath) {
  const startedAt = Date.now();

  console.log("[Voca] Transcribing with Whisper...");

  const args = [
    "-m", WHISPER_MODEL_PATH,
    "-f", wavPath,
    "-nt", // no timestamps, plain text only
    "-l", "auto", // change to "en" to force English and skip language detection
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

    const text = output.trim();

    console.log(`[Voca] Transcript (${elapsed}s):`, text);

    if (notchWin && !notchWin.isDestroyed()) {
      notchWin.webContents.send("transcription-result", text);
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

function setupKeyboard() {
  // ---------------------------------------------------------
  // KEY DOWN
  // ---------------------------------------------------------

  uIOhook.on(
    "keydown",
    (event) => {
      // -----------------------------------------------------
      // SETUP KEY CAPTURE MODE
      // -----------------------------------------------------

      if (keyCaptureActive) {
        const keycode = event.keycode;

        const keyId = `keycode:${event.keycode}`;
        const label = getKeyLabel(event.keycode);

        keyCaptureWindow.send("key-detected", {
          id: keyId,
          label: label,
        });

        // Only detect one key press
        keyCaptureActive = false;

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

      keyIsDown = true;

      altHoldTimer = setTimeout(() => {
        if (
          keyIsDown &&
          notchWin &&
          !notchWin.isDestroyed()
        ) {
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
      if (
        !activeKeyCodes.includes(
          event.keycode
        )
      ) {
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