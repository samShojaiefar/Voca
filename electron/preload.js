const {
  contextBridge,
  ipcRenderer,
} = require("electron");

contextBridge.exposeInMainWorld(
  "voiceOS",
  {
    // -------------------------------------------------------
    // Existing notch listener
    // -------------------------------------------------------

    onAltState: (callback) => {
      ipcRenderer.on(
        "alt-state",
        (_event, isDown) => {
          callback(isDown);
        }
      );
    },

    // -------------------------------------------------------
    // Config
    // -------------------------------------------------------

    getKeyOptions: () =>
      ipcRenderer.invoke(
        "get-key-options"
      ),

    getConfig: () =>
      ipcRenderer.invoke(
        "get-config"
      ),

    setTriggerKey: (keyId) =>
      ipcRenderer.invoke(
        "set-trigger-key",
        keyId
      ),

    finishSetup: (keyId) =>
      ipcRenderer.invoke(
        "finish-setup",
        keyId
      ),

    // -------------------------------------------------------
    // NEW: keyboard capture
    // -------------------------------------------------------

    startKeyCapture: (callback) => {
      const handler = (
        _event,
        key
      ) => {
        callback(key);
      };

      ipcRenderer.on(
        "key-detected",
        handler
      );

      ipcRenderer.send(
        "start-key-capture"
      );

      return () => {
        ipcRenderer.removeListener(
          "key-detected",
          handler
        );

        ipcRenderer.send(
          "stop-key-capture"
        );
      };
    },

    stopKeyCapture: () => {
      ipcRenderer.send(
        "stop-key-capture"
      );
    },

    // -------------------------------------------------------
    // NEW: whisper transcription result
    // -------------------------------------------------------

    onTranscriptionResult: (callback) => {
      const handler = (_event, text) => {
        callback(text);
      };

      ipcRenderer.on(
        "transcription-result",
        handler
      );

      return () => {
        ipcRenderer.removeListener(
          "transcription-result",
          handler
        );
      };
    },

    // -------------------------------------------------------
    // NEW: send a recorded WAV (ArrayBuffer) to main for
    // whisper.cpp transcription. Recording itself happens in
    // the renderer via getUserMedia — no sox/mic dependency.
    // -------------------------------------------------------

    sendAudioBuffer: (arrayBuffer) => {
      ipcRenderer.send(
        "audio-recorded",
        arrayBuffer
      );
    },
  }
);