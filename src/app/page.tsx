"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    voiceOS: {
      onAltState: (callback: (isDown: boolean) => void) => void;
      onTranscriptionResult?: (
        callback: (text: string) => void
      ) => () => void;
      sendAudioBuffer?: (arrayBuffer: ArrayBuffer) => void;
    };
  }
}

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

type NotchState = "idle" | "listening" | "processing" | "result";

export default function Home() {
  const [notchState, setNotchState] = useState<NotchState>("idle");
  const [transcript, setTranscript] = useState("");

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
          if (!recordingRef.current) return;
          chunksRef.current.push(
            new Float32Array(e.inputBuffer.getChannelData(0))
          );
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

      hideTimerRef.current = setTimeout(() => {
        setNotchState("idle");
      }, 5000);
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

  const expanded = notchState !== "idle";

  return (
    <main className="container">
      <div className={expanded ? "alt-voice-topbar" : "voice-topbar"}>
        {notchState === "listening" && (
          <span className="voice-status">
            <span className="voice-listening-dot" />
            Listening…
          </span>
        )}

        {notchState === "processing" && (
          <span className="voice-status">
            <span className="voice-listening-dot voice-listening-dot-processing" />
            Transcribing…
          </span>
        )}

        {notchState === "result" && (
          <span className="voice-result-text">{transcript}</span>
        )}
      </div>
    </main>
  );
}