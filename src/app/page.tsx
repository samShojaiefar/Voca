"use client";

import { useEffect, useRef, useState } from "react";



const TARGET_SAMPLE_RATE = 16000;

// -----------------------------------------------------------------------
// Downsample a Float32 PCM buffer to the target sample rate (whisper.cpp
// wants 16kHz mono). Simple averaging decimation — no ffmpeg/sox needed.
// -----------------------------------------------------------------------
function downsampleBuffer(
  buffer: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (outputSampleRate === inputSampleRate) {
    return buffer;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);

    let accum = 0;
    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer && i < buffer.length;
      i++
    ) {
      accum += buffer[i];
      count++;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;

    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);

  let offset = 0;

  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function encodeWav(pcm16: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitDepth = 16;
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;
  const dataSize = pcm16.byteLength;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(new Uint8Array(pcm16));

  return buffer;
}

// ---------------------------------------------------------------------------
// THEMES
//
// A theme = a block of CSS variables in globals.css (`.notch[data-theme="x"]`)
// + one entry here that says which visualizer / pieces it uses.
//
// To add a new design concept:
//   1. Copy the "NEW THEME TEMPLATE" block at the bottom of globals.css,
//      rename `your-theme`, and change the colours / sizes.
//   2. Add an entry to THEMES below with the same id.
//   3. Set ACTIVE_THEME to that id (or test it live from the devtools
//      console with:  localStorage.setItem("voca-theme", "your-theme")  and reload).
// ---------------------------------------------------------------------------

type ThemeConfig = {
  // listening visual: "bars" = live voice-level bars, "dots" = one pulsing dot
  visual: "bars" | "dots";
  // how many bars (only for visual "bars")
  bars: number;
  // transcribing visual: "wave" = calm bar wave, "typing" = bouncing dots
  processing: "wave" | "typing";
  // small dot / orb on the left while live
  orb: boolean;
  // keep the orb in the result state too
  orbInResult: boolean;
  // show the "Listening" / "Transcribing" text
  label: boolean;
  labels: { listening: string; processing: string };
};

const THEMES: Record<string, ThemeConfig> = {
  // Minimal, Apple-like: pure black pill, orange mic dot, thin white
  // waveform, iMessage-style typing dots, system font.
  apple: {
    visual: "bars",
    bars: 5,
    processing: "typing",
    orb: true,
    orbInResult: false,
    label: false,
    labels: { listening: "Listening", processing: "Transcribing" },
  },

  // Glass pill, glowing orb, live voice bars.
  glass: {
    visual: "bars",
    bars: 7,
    processing: "wave",
    orb: true,
    orbInResult: true,
    label: true,
    labels: { listening: "Listening", processing: "Transcribing" },
  },

  // The original look: black bar, pulsing dot, plain text.
  classic: {
    visual: "dots",
    bars: 0,
    processing: "wave",
    orb: false,
    orbInResult: false,
    label: true,
    labels: { listening: "Listening…", processing: "Transcribing…" },
  },
};

const ACTIVE_THEME = "apple";
const THEME_STORAGE_KEY = "voca-theme";

// How strongly a bar reacts to your voice (middle bars move the most).
function barWeight(i: number, count: number) {
  const mid = (count - 1) / 2;

  return mid === 0 ? 1 : 1 - (Math.abs(i - mid) / mid) * 0.6;
}

// "emoji heart" -> only an emoji came back -> show it big with a pop.
const EMOJI_ONLY =
  /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]+$/u;

// main.js reuses the result channel for the Ctrl+Shift+L confirmation.
const LANGUAGE_MESSAGE = /^Language:\s*(.+)$/i;

type NotchState = "idle" | "listening" | "processing" | "result";

// ---------------------------------------------------------------------------
// Visualizer: orb halo + bars follow the mic level (written straight to the
// DOM every frame, so React never re-renders while you talk).
// ---------------------------------------------------------------------------

function Visualizer({
  visual,
  bars: barCount,
  processing,
  mode,
  levelRef,
  rootRef,
}: {
  visual: ThemeConfig["visual"];
  bars: number;
  processing: ThemeConfig["processing"];
  mode: "listening" | "processing";
  levelRef: React.MutableRefObject<number>;
  rootRef: React.RefObject<HTMLDivElement | null>;
}) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const bars = barsRef.current;

    if (mode !== "listening") {
      rootRef.current?.style.setProperty("--level", "0");
      bars.forEach((bar) => {
        if (bar) bar.style.transform = "";
      });
      return;
    }

    let raf = 0;
    let smooth = 0;

    const tick = (t: number) => {
      const raw = Math.min(1, levelRef.current * 7);

      // fast attack, slow release = feels like a real level meter
      smooth = raw > smooth ? raw : smooth * 0.88 + raw * 0.12;

      const v = Math.pow(smooth, 0.6);

      rootRef.current?.style.setProperty("--level", v.toFixed(3));

      bars.forEach((bar, i) => {
        if (!bar) return;

        const idle = 0.2 + 0.08 * Math.sin(t / 220 + i * 0.9);
        const wobble = 0.75 + 0.25 * Math.sin(t / 95 + i * 1.7);
        const h = Math.min(1, idle + v * barWeight(i, bars.length) * wobble);

        bar.style.transform = `scaleY(${h.toFixed(3)})`;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [mode, levelRef, rootRef]);

  if (mode === "processing" && processing === "typing") {
    return (
      <span className="notch-typing">
        <span />
        <span />
        <span />
      </span>
    );
  }

  if (visual === "dots") {
    return <span className="notch-dot" data-mode={mode} />;
  }

  return (
    <span className="notch-bars" data-mode={mode}>
      {Array.from({ length: barCount }, (_, i) => (
        <span
          key={i}
          className="notch-bar"
          style={{ "--i": i } as React.CSSProperties}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Result: normal text, a language switch confirmation, or a lone emoji.
// ---------------------------------------------------------------------------

function ResultContent({ text, orb }: { text: string; orb: boolean }) {
  const language = text.match(LANGUAGE_MESSAGE);

  if (language) {
    return (
      <div className="notch-content">
        <span className="notch-tag">Language</span>
        <span className="notch-result" dir="auto">
          {language[1]}
        </span>
      </div>
    );
  }

  if (EMOJI_ONLY.test(text)) {
    return (
      <div className="notch-content notch-content-center">
        <span className="notch-result-emoji">{text.trim()}</span>
      </div>
    );
  }

  return (
    <div className="notch-content">
      {orb && <span className="notch-orb" />}
      <span className="notch-result" dir="auto">
        {text}
      </span>
    </div>
  );
}

export default function Home() {
  const [notchState, setNotchState] = useState<NotchState>("idle");
  const [transcript, setTranscript] = useState("");
  const [theme, setTheme] = useState<string>(ACTIVE_THEME);

  const notchRef = useRef<HTMLDivElement | null>(null);
  const levelRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const recordingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Optional live override for trying designs without editing the code.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);

      if (saved && THEMES[saved]) {
        setTheme(saved);
      }
    } catch {
      // storage unavailable — keep ACTIVE_THEME
    }
  }, []);

  // Set up the mic graph once, on mount, so holding the trigger key never
  // has to wait on a getUserMedia round trip. The mic stays open but is
  // only captured into `chunksRef` while `recordingRef.current` is true.
  useEffect(() => {
    let cancelled = false;

    async function initMic() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (!recordingRef.current) {
            levelRef.current = 0;
            return;
          }

          const data = e.inputBuffer.getChannelData(0);

          // Volume (RMS) for the notch visualizer.
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            sum += data[i] * data[i];
          }
          levelRef.current = Math.sqrt(sum / data.length);

          chunksRef.current.push(new Float32Array(data));
        };

        // A silent gain node keeps the graph "live" without echoing mic
        // audio back out the speakers.
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;

        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      } catch (err) {
        console.error("[Voca] Microphone access failed:", err);
      }
    }

    initMic();

    return () => {
      cancelled = true;
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
    };
  }, []);

  function flushAndSend(): boolean {
    const audioCtx = audioCtxRef.current;
    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (!audioCtx || chunks.length === 0) return false;

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalLength);

    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const downsampled = downsampleBuffer(
      merged,
      audioCtx.sampleRate,
      TARGET_SAMPLE_RATE
    );
    const pcm16 = floatTo16BitPCM(downsampled);
    const wav = encodeWav(pcm16, TARGET_SAMPLE_RATE);

    window.voiceOS?.sendAudioBuffer?.(wav);

    return true;
  }

  useEffect(() => {
    window.voiceOS?.onAltState((isDown) => {
      if (isDown) {
        // Fresh press — clear any leftover result and start listening.
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
        }
        setTranscript("");
        setNotchState("listening");

        chunksRef.current = [];
        recordingRef.current = true;
      } else {
        // Key released — stop capturing but stay expanded while we wait
        // on whisper. flushAndSend() triggers transcription; the bar
        // only collapses once the result (or lack of audio) is handled.
        recordingRef.current = false;
        levelRef.current = 0;
        setNotchState("processing");

        const sent = flushAndSend();

        if (!sent) {
          setNotchState("idle");
        } else {
          // Safety net: whisper on CPU can take a while, but if it hangs
          // or crashes we still want the notch to recover rather than
          // stay expanded forever.
          if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
          }
          processingTimeoutRef.current = setTimeout(() => {
            setNotchState((current) =>
              current === "processing" ? "idle" : current
            );
          }, 90000);
        }
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribe = window.voiceOS?.onTranscriptionResult?.((text) => {
      console.log("[Voca] Transcript:", text);

      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }

      if (!text) {
        setNotchState("idle");
        return;
      }

      setTranscript(text);
      setNotchState("result");

      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      // The language-switch confirmation is just a quick flash.
      const showFor = LANGUAGE_MESSAGE.test(text) ? 1800 : 5000;

      hideTimerRef.current = setTimeout(() => {
        setNotchState("idle");
      }, showFor);
    });

    return () => {
      unsubscribe?.();
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, []);

  const config = THEMES[theme] ?? THEMES[ACTIVE_THEME];
  const live = notchState === "listening" || notchState === "processing";

  return (
    <main className="container">
      <div
        ref={notchRef}
        className="notch"
        data-theme={theme}
        data-state={notchState}
      >
        {live && (
          <div key="live" className="notch-content">
            {config.orb && <span className="notch-orb" />}

            <Visualizer
              visual={config.visual}
              bars={config.bars}
              processing={config.processing}
              mode={notchState === "listening" ? "listening" : "processing"}
              levelRef={levelRef}
              rootRef={notchRef}
            />

            {config.label && (
              <span className="notch-label">
                {notchState === "listening"
                  ? config.labels.listening
                  : config.labels.processing}
              </span>
            )}
          </div>
        )}

        {notchState === "result" && (
          <ResultContent
            key="result"
            text={transcript}
            orb={config.orb && config.orbInResult}
          />
        )}
      </div>
    </main>
  );
}