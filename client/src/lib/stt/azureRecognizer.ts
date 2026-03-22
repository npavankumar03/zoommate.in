import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

export interface AzureRecognizerCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
}

export interface AzureRecognizerOptions {
  language?: string;
  silenceTimeoutMs?: number;
  phraseHints?: string[];
  vadEnabled?: boolean;
  vadNoiseFloor?: number;
  targetRms?: number;
  maxGain?: number;
  clippingThreshold?: number;
  silenceHoldFrames?: number;
}

interface TokenResponse {
  token: string;
  region: string;
  expires_in_seconds: number;
}

async function fetchAzureToken(): Promise<TokenResponse> {
  const started = Date.now();
  const res = await fetch("/api/speech/azure/token", { credentials: "include" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Failed to get Azure token" }));
    const message = `${err.message || "Failed to get Azure token"} (status=${res.status})`;
    console.error("[AzureRecognizer] token fetch failed:", message);
    throw new Error(message);
  }
  const token = await res.json();
  console.log(`[AzureRecognizer] token fetched in ${Date.now() - started}ms region=${token.region}`);
  return token;
}

export class AzureRecognizer {
  private recognizer: SpeechSDK.SpeechRecognizer | null = null;
  private callbacks: AzureRecognizerCallbacks;
  private options: AzureRecognizerOptions;
  private running = false;
  private audioStream: SpeechSDK.PushAudioInputStream | null = null;
  private processorNode: ScriptProcessorNode | AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;

  constructor(callbacks: AzureRecognizerCallbacks, options: AzureRecognizerOptions = {}) {
    this.callbacks = callbacks;
    this.options = {
      language: options.language || "en-US",
      // Keep Azure phrase segmentation moderate to avoid choppy over-segmentation.
      silenceTimeoutMs: options.silenceTimeoutMs || 600,
      phraseHints: (options.phraseHints || []).slice(0, 200),
      vadEnabled: options.vadEnabled ?? true,
      vadNoiseFloor: options.vadNoiseFloor ?? 0.008,
      targetRms: options.targetRms ?? 0.12,
      maxGain: options.maxGain ?? 4,
      clippingThreshold: options.clippingThreshold ?? 0.92,
      silenceHoldFrames: options.silenceHoldFrames ?? 2,
    };
  }

  private preprocessFloatChunk(inputData: Float32Array): Int16Array {
    const vadEnabled = this.options.vadEnabled !== false;
    const noiseFloor = Math.max(0.002, Math.min(0.08, this.options.vadNoiseFloor ?? 0.015));
    const targetRms = Math.max(0.04, Math.min(0.3, this.options.targetRms ?? 0.12));
    const maxGain = Math.max(1, Math.min(8, this.options.maxGain ?? 4));
    const clippingThreshold = Math.max(0.6, Math.min(0.98, this.options.clippingThreshold ?? 0.92));

    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < inputData.length; i++) {
      const sample = inputData[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, inputData.length));
    const pcm16 = new Int16Array(inputData.length);

    if (vadEnabled && rms < noiseFloor) {
      pcm16.fill(0);
      return pcm16;
    }

    const desiredGain = rms > 0.0001 ? targetRms / rms : maxGain;
    const gain = Math.max(0.9, Math.min(maxGain, desiredGain));

    for (let i = 0; i < inputData.length; i++) {
      let processed = inputData[i] * gain;
      if (Math.abs(processed) > clippingThreshold) {
        processed = Math.sign(processed) * clippingThreshold;
      }
      if (peak > 0.98) {
        processed *= 0.92;
      }
      const s = Math.max(-1, Math.min(1, processed));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    return pcm16;
  }

  async startFromMic(): Promise<void> {
    this.callbacks.onStatusChange("connecting");
    const tokenData = await fetchAzureToken();

    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
      tokenData.token,
      tokenData.region,
    );
    speechConfig.speechRecognitionLanguage = this.options.language!;
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(this.options.silenceTimeoutMs));
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, String(this.options.silenceTimeoutMs));

    let audioConfig: SpeechSDK.AudioConfig;
    try {
      audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    } catch (err: any) {
      const msg = String(err?.message || err || "Failed to access microphone");
      console.error("[AzureRecognizer] microphone init failed:", msg);
      this.callbacks.onError(`Microphone access failed: ${msg}`);
      this.callbacks.onStatusChange("error");
      throw err;
    }
    this.setupRecognizer(speechConfig, audioConfig);
  }

  /**
   * Mix multiple MediaStreams (e.g. mic + tab audio) into a single AudioContext
   * destination and feed the result to Azure STT as a push stream.
   * Uses mic-tuned VAD/silence values since the primary use-case is mic + tab mixing.
   */
  async startFromMixedStreams(streams: MediaStream[]): Promise<void> {
    this.callbacks.onStatusChange("connecting");
    const tokenData = await fetchAzureToken();

    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
      tokenData.token,
      tokenData.region,
    );
    speechConfig.speechRecognitionLanguage = this.options.language!;
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(this.options.silenceTimeoutMs));
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, String(this.options.silenceTimeoutMs));

    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    this.audioStream = SpeechSDK.AudioInputStream.createPushStream(format);

    this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    const destination = this.audioContext.createMediaStreamDestination();

    for (const stream of streams) {
      if (stream.getAudioTracks().length === 0) continue;
      const source = this.audioContext.createMediaStreamSource(stream);
      // Boost each source slightly so quieter tab audio is still audible to Azure
      const gain = this.audioContext.createGain();
      gain.gain.value = 1.2;
      source.connect(gain);
      gain.connect(destination);
    }

    const mergedSource = this.audioContext.createMediaStreamSource(destination.stream);

    if (this.audioContext.audioWorklet) {
      try {
        await this.audioContext.audioWorklet.addModule("/pcm-processor.js");
        const workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
        workletNode.port.postMessage({
          noiseFloor: this.options.vadNoiseFloor ?? 0.014,
          targetRms: this.options.targetRms ?? 0.12,
          maxGain: this.options.maxGain ?? 4,
          limiter: this.options.clippingThreshold ?? 0.92,
          silenceHoldFrames: this.options.silenceHoldFrames ?? 2,
        });
        workletNode.port.onmessage = (ev: MessageEvent) => {
          if (this.audioStream && this.running) {
            this.audioStream.write(ev.data as ArrayBuffer);
          }
        };
        mergedSource.connect(workletNode);
        workletNode.connect(this.audioContext.destination);
        this.processorNode = workletNode;
      } catch {
        this.setupScriptProcessor(mergedSource);
      }
    } else {
      this.setupScriptProcessor(mergedSource);
    }

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(this.audioStream);
    this.setupRecognizer(speechConfig, audioConfig);
  }

  async startFromStream(mediaStream: MediaStream): Promise<void> {
    this.callbacks.onStatusChange("connecting");
    const tokenData = await fetchAzureToken();

    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
      tokenData.token,
      tokenData.region,
    );
    speechConfig.speechRecognitionLanguage = this.options.language!;
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(this.options.silenceTimeoutMs));
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, String(this.options.silenceTimeoutMs));

    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    this.audioStream = SpeechSDK.AudioInputStream.createPushStream(format);

    this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    const source = this.audioContext.createMediaStreamSource(mediaStream);

    if (this.audioContext.audioWorklet) {
      try {
        await this.audioContext.audioWorklet.addModule("/pcm-processor.js");
        const workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
        workletNode.port.postMessage({
          noiseFloor: this.options.vadNoiseFloor ?? 0.015,
          targetRms: this.options.targetRms ?? 0.12,
          maxGain: this.options.maxGain ?? 4,
          limiter: this.options.clippingThreshold ?? 0.92,
          silenceHoldFrames: this.options.silenceHoldFrames ?? 2,
        });
        workletNode.port.onmessage = (ev: MessageEvent) => {
          if (this.audioStream && this.running) {
            const pcmData = ev.data as ArrayBuffer;
            this.audioStream.write(pcmData);
          }
        };
        source.connect(workletNode);
        workletNode.connect(this.audioContext.destination);
        this.processorNode = workletNode;
      } catch {
        this.setupScriptProcessor(source);
      }
    } else {
      this.setupScriptProcessor(source);
    }

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(this.audioStream);
    this.setupRecognizer(speechConfig, audioConfig);
  }

  private setupScriptProcessor(source: MediaStreamAudioSourceNode) {
    const processor = this.audioContext!.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
      if (!this.audioStream || !this.running) return;
      const inputData = ev.inputBuffer.getChannelData(0);
      const pcm16 = this.preprocessFloatChunk(inputData);
      this.audioStream.write(pcm16.buffer);
    };
    source.connect(processor);
    processor.connect(this.audioContext!.destination);
    this.processorNode = processor as any;
  }

  private setupRecognizer(speechConfig: SpeechSDK.SpeechConfig, audioConfig: SpeechSDK.AudioConfig) {
    this.recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    this.running = true;
    if (this.options.phraseHints && this.options.phraseHints.length > 0) {
      try {
        const phraseList = SpeechSDK.PhraseListGrammar.fromRecognizer(this.recognizer);
        const seen = new Set<string>();
        for (const raw of this.options.phraseHints) {
          const phrase = String(raw || "").trim();
          if (!phrase) continue;
          const key = phrase.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          phraseList.addPhrase(phrase);
        }
      } catch (err) {
        console.warn("[AzureRecognizer] Failed to set phrase hints:", err);
      }
    }

    this.recognizer.recognizing = (_sender, event) => {
      if (!this.running) return;
      const text = event.result.text;
      if (text) {
        // Partial UI updates only. Do not convert partials into finals on client side.
        this.callbacks.onPartial(text);
      }
    };

    this.recognizer.recognized = (_sender, event) => {
      if (!this.running) return;
      if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
        const text = event.result.text?.trim();
        if (text) {
          // Final transcript commits come only from Azure recognized events.
          this.callbacks.onFinal(text);
        }
      }
    };

    this.recognizer.canceled = (_sender, event) => {
      // Ignore cancellations that happen after we intentionally called stop().
      // Azure always fires a canceled/WebSocket-close event when we terminate the
      // connection ourselves — treating that as an error produces a spurious
      // "request timed out" toast even though the session ended cleanly.
      if (!this.running) return;
      if (event.reason === SpeechSDK.CancellationReason.Error) {
        const details = event.errorDetails || "Recognition canceled";
        console.error("[AzureRecognizer] Canceled:", details);
        const lower = details.toLowerCase();
        if (lower.includes("1006") || lower.includes("websocket")) {
          this.callbacks.onError(`Azure websocket failure: ${details}`);
        } else if (lower.includes("region")) {
          this.callbacks.onError(`Azure region mismatch/config error: ${details}`);
        } else if (lower.includes("token")) {
          this.callbacks.onError(`Azure token/auth failure: ${details}`);
        } else {
          this.callbacks.onError(details);
        }
        this.callbacks.onStatusChange("error");
      }
    };

    this.recognizer.sessionStarted = () => {
      this.callbacks.onStatusChange("connected");
    };

    this.recognizer.sessionStopped = () => {
      if (this.running) {
        this.callbacks.onStatusChange("disconnected");
      }
    };

    this.recognizer.startContinuousRecognitionAsync(
      () => {
        console.log("[AzureRecognizer] Started continuous recognition");
      },
      (err) => {
        const message = String(err);
        console.error("[AzureRecognizer] Start failed:", message);
        this.callbacks.onError(`Azure start failed: ${message}`);
        this.callbacks.onStatusChange("error");
      },
    );
  }

  stop(): void {
    this.running = false;

    if (this.recognizer) {
      this.recognizer.stopContinuousRecognitionAsync(
        () => {
          this.recognizer?.close();
          this.recognizer = null;
        },
        (err) => {
          console.error("[AzureRecognizer] Stop error:", err);
          this.recognizer?.close();
          this.recognizer = null;
        },
      );
    }

    if (this.audioStream) {
      this.audioStream.close();
      this.audioStream = null;
    }

    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }

    this.processorNode = null;
    this.callbacks.onStatusChange("disconnected");
  }

  isRunning(): boolean {
    return this.running;
  }
}

export async function checkAzureAvailability(): Promise<boolean> {
  try {
    const res = await fetch("/api/speech/azure/status", { credentials: "include" });
    if (!res.ok) return false;
    const data = await res.json();
    return data.configured === true;
  } catch {
    return false;
  }
}
