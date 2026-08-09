"use client";

import { useCallback, useRef, useState } from "react";

export type RecordingState = "idle" | "recording" | "processing";

/**
 * 麦克风录音 → 16kHz / 16bit / mono PCM。
 * 用 ScriptProcessorNode（兼容性最好，iOS Safari 也支持），录音完成后
 * 一次性产出 ArrayBuffer 供后端 ASR 使用。
 */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pcmResult, setPcmResult] = useState<ArrayBuffer | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Int16Array[]>([]);
  const recordingRef = useRef(false);

  // 降采样：把 44.1k/48k 输入降到 16kHz
  const downsample = (
    input: Float32Array,
    fromRate: number,
    toRate = 16000,
  ): Float32Array => {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const outLen = Math.round(input.length / ratio);
    const output = new Float32Array(outLen);
    let offset = 0;
    for (let i = 0; i < outLen; i++) {
      const next = Math.round((i + 1) * ratio);
      let sum = 0;
      let count = 0;
      for (let j = offset; j < Math.min(next, input.length); j++) {
        sum += input[j];
        count++;
      }
      if (count > 0) output[i] = sum / count;
      offset = next;
    }
    return output;
  };

  const floatTo16BitPcm = (input: Float32Array): Int16Array => {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output;
  };

  const start = useCallback(async () => {
    setError(null);
    setPcmResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtor();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const sampleRate = ctx.sampleRate;

      ctxRef.current = ctx;
      streamRef.current = stream;
      sourceRef.current = source;
      processorRef.current = processor;
      chunksRef.current = [];
      recordingRef.current = true;

      processor.onaudioprocess = (e) => {
        if (!recordingRef.current) return;
        const input = e.inputBuffer.getChannelData(0);
        const mono = downsample(input, sampleRate, 16000);
        chunksRef.current.push(floatTo16BitPcm(mono));
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setRecording("recording");
    } catch (err) {
      setError(
        `无法访问麦克风：${err instanceof Error ? err.message : String(err)}`,
      );
      setRecording("idle");
    }
  }, []);

  const stop = useCallback((): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      recordingRef.current = false;
      setRecording("processing");
      try {
        processorRef.current?.disconnect();
        sourceRef.current?.disconnect();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        void ctxRef.current?.close().catch(() => undefined);

        const chunks = chunksRef.current;
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Int16Array(total);
        let offset = 0;
        for (const c of chunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        const buffer = new ArrayBuffer(merged.length * 2);
        new Int16Array(buffer).set(merged);

        chunksRef.current = [];
        processorRef.current = null;
        sourceRef.current = null;
        streamRef.current = null;
        ctxRef.current = null;
        setPcmResult(buffer);
        setRecording("idle");
        resolve(buffer);
      } catch (err) {
        setRecording("idle");
        reject(err);
      }
    });
  }, []);

  const cancel = useCallback(() => {
    recordingRef.current = false;
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => undefined);
    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    ctxRef.current = null;
    chunksRef.current = [];
    setRecording("idle");
  }, []);

  return { recording, error, pcmResult, start, stop, cancel };
}
