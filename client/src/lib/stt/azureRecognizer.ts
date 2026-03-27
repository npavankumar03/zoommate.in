import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

export interface AzureRecognizerCallbacks {
  onPartial: (text: string, meta?: AzureTranscriptMeta) => void;
  onFinal: (text: string, meta?: AzureTranscriptMeta) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
}

export interface AzureTranscriptMeta {
  confidence?: number;
  durationMs?: number;
  offsetMs?: number;
  language?: string;
  isSpeech?: boolean;
  rms?: number;
  noiseLikely?: boolean;
  source?: "partial" | "final";
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
  preRollMs?: number;
  postSpeechHoldMs?: number;
  minSpeechRms?: number;
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
  private speechConfig: SpeechSDK.SpeechConfig | null = null;
  private callbacks: AzureRecognizerCallbacks;
  private options: AzureRecognizerOptions;
  private running = false;
  private intentionalStop = false;
  private audioStream: SpeechSDK.PushAudioInputStream | null = null;
  private processorNode: ScriptProcessorNode | AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  private lastChunkMeta: AzureTranscriptMeta = { isSpeech: false, rms: 0, noiseLikely: false };
  private preRollBuffers: Int16Array[] = [];
  private maxPreRollSamples = 0;
  private speechActive = false;
  private silenceTailMs = 0;
  private audioSampleRate = 16000;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempts = 0;
  private startMode: "mic" | "stream" | "mixed" | null = null;
  private sourceStream: MediaStream | null = null;
  private sourceStreams: MediaStream[] = [];
  private lastTokenRegion = "";

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
      preRollMs: options.preRollMs ?? 800,
      postSpeechHoldMs: options.postSpeechHoldMs ?? 600,
      minSpeechRms: options.minSpeechRms ?? 0.01,
    };
  }

  private clearLifecycleTimers() {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private scheduleTokenRefresh(expiresInSeconds?: number) {
    if (!expiresInSeconds || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return;
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }
    const refreshInMs = Math.max(30_000, (expiresInSeconds * 1000) - 90_000);
    this.tokenRefreshTimer = setTimeout(() => {
      void this.refreshToken().catch((err) => {
        const message = String(err?.message || err || "Azure token refresh failed");
        console.error("[AzureRecognizer] token refresh failed:", message);
        this.callbacks.onError(`Azure token refresh failed: ${message}`);
      });
    }, refreshInMs);
  }

  private async refreshToken(): Promise<void> {
    if (!this.running || this.intentionalStop || !this.recognizer) return;
    const tokenData = await fetchAzureToken();
    this.lastTokenRegion = tokenData.region;
    if (this.speechConfig) {
      this.speechConfig.authorizationToken = tokenData.token;
    }
    (this.recognizer as any).authorizationToken = tokenData.token;
    this.scheduleTokenRefresh(tokenData.expires_in_seconds);
    console.log("[AzureRecognizer] token refreshed for active session");
  }

  private createSpeechConfig(tokenData: TokenResponse): SpeechSDK.SpeechConfig {
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
      tokenData.token,
      tokenData.region,
    );
    speechConfig.speechRecognitionLanguage = this.options.language!;
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(this.options.silenceTimeoutMs));
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, String(this.options.silenceTimeoutMs));
    this.speechConfig = speechConfig;
    this.lastTokenRegion = tokenData.region;
    this.scheduleTokenRefresh(tokenData.expires_in_seconds);
    return speechConfig;
  }

  private async createSpeechConfigFromFreshToken(): Promise<SpeechSDK.SpeechConfig> {
    const tokenData = await fetchAzureToken();
    return this.createSpeechConfig(tokenData);
  }

  private cleanupRecognitionResources() {
    if (this.recognizer) {
      try { this.recognizer.close(); } catch {}
      this.recognizer = null;
    }
    if (this.audioStream) {
      try { this.audioStream.close(); } catch {}
      this.audioStream = null;
    }
    if (this.audioContext) {
      try { this.audioContext.close(); } catch {}
      this.audioContext = null;
    }
    this.processorNode = null;
    this.resetAudioState();
  }

  private async restartFromLastSource(): Promise<void> {
    if (this.intentionalStop) return;
    this.cleanupRecognitionResources();
    const speechConfig = await this.createSpeechConfigFromFreshToken();
    if (this.startMode === "mic") {
      let audioConfig: SpeechSDK.AudioConfig;
      try {
        audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      } catch (err: any) {
        const msg = String(err?.message || err || "Failed to access microphone");
        console.error("[AzureRecognizer] microphone restart failed:", msg);
        throw new Error(`Microphone access failed: ${msg}`);
      }
      this.setupRecognizer(speechConfig, audioConfig);
      return;
    }
    if (this.startMode === "mixed") {
      const streams = this.sourceStreams.filter((stream) => stream?.getAudioTracks().some((track) => track.readyState === "live"));
      if (!streams.length) {
        throw new Error("Audio source lost");
      }
      this.setupMixedAudioPipeline(streams, speechConfig);
      return;
    }
    if (this.startMode === "stream" && this.sourceStream) {
      const liveTrack = this.sourceStream.getAudioTracks().find((track) => track.readyState === "live");
      if (!liveTrack) {
        throw new Error("Audio source lost");
      }
      this.setupSingleStreamAudioPipeline(this.sourceStream, speechConfig);
      return;
    }
    throw new Error("No audio source available for restart");
  }

  private scheduleRecognizerRestart(reason: string) {
    if (!this.running || this.intentionalStop || this.restartTimer) return;
    const backoffMs = Math.min(8_000, 800 * (this.restartAttempts + 1));
    this.callbacks.onStatusChange("connecting");
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.running || this.intentionalStop) return;
      this.restartAttempts += 1;
      console.warn(`[AzureRecognizer] restarting after ${reason} (attempt ${this.restartAttempts})`);
      void this.restartFromLastSource().then(() => {
        this.restartAttempts = 0;
      }).catch((err) => {
        const message = String(err?.message || err || "Azure restart failed");
        console.error("[AzureRecognizer] restart failed:", message);
        this.callbacks.onError(`Azure restart failed: ${message}`);
        this.callbacks.onStatusChange("error");
      });
    }, backoffMs);
  }

  private preprocessFloatChunk(inputData: Float32Array): { pcm16: Int16Array; meta: AzureTranscriptMeta } {
    const vadEnabled = this.options.vadEnabled !== false;
    const noiseFloor = Math.max(0.002, Math.min(0.08, this.options.vadNoiseFloor ?? 0.015));
    const targetRms = Math.max(0.04, Math.min(0.3, this.options.targetRms ?? 0.12));
    const maxGain = Math.max(1, Math.min(8, this.options.maxGain ?? 4));
    const clippingThreshold = Math.max(0.6, Math.min(0.98, this.options.clippingThreshold ?? 0.92));
    const minSpeechRms = Math.max(0.003, Math.min(0.1, this.options.minSpeechRms ?? Math.max(noiseFloor * 1.2, 0.01)));
    const postSpeechHoldMs = Math.max(80, Math.min(1200, this.options.postSpeechHoldMs ?? 260));
    const chunkMs = Math.max(1, Math.round((inputData.length / this.audioSampleRate) * 1000));

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
    const isSpeech = rms >= minSpeechRms;
    const noiseLikely = rms < noiseFloor;

    if (isSpeech) {
      this.speechActive = true;
      this.silenceTailMs = 0;
    } else if (this.speechActive) {
      this.silenceTailMs += chunkMs;
      if (this.silenceTailMs > postSpeechHoldMs) {
        this.speechActive = false;
      }
    }

    if (vadEnabled && noiseLikely && !this.speechActive) {
      pcm16.fill(0);
      return {
        pcm16,
        meta: { rms, isSpeech: false, noiseLikely: true, source: "partial" },
      };
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

    return {
      pcm16,
      meta: { rms, isSpeech: this.speechActive || isSpeech, noiseLikely, source: "partial" },
    };
  }

  private resetAudioState() {
    this.lastChunkMeta = { isSpeech: false, rms: 0, noiseLikely: false };
    this.preRollBuffers = [];
    this.speechActive = false;
    this.silenceTailMs = 0;
  }

  private primePreRoll(buffer: Int16Array) {
    this.preRollBuffers.push(buffer);
    let sampleCount = this.preRollBuffers.reduce((sum, chunk) => sum + chunk.length, 0);
    while (sampleCount > this.maxPreRollSamples && this.preRollBuffers.length > 0) {
      const removed = this.preRollBuffers.shift();
      sampleCount -= removed?.length || 0;
    }
  }

  private writeChunkToAzure(buffer: Int16Array, meta: AzureTranscriptMeta) {
    if (!this.audioStream || !this.running) return;
    const shouldWriteSpeech = meta.isSpeech || meta.rms === undefined || (meta.rms >= Math.max(this.options.minSpeechRms ?? 0.01, 0.003));
    if (!shouldWriteSpeech) {
      this.primePreRoll(buffer);
      this.lastChunkMeta = meta;
      return;
    }

    const previousWasSpeech = !!this.lastChunkMeta.isSpeech;
    if (!previousWasSpeech && this.preRollBuffers.length > 0) {
      for (const chunk of this.preRollBuffers) {
        this.audioStream.write(chunk.buffer.slice(0));
      }
      this.preRollBuffers = [];
    }

    this.audioStream.write(buffer.buffer.slice(0));
    this.lastChunkMeta = meta;
  }

  private buildAzureMeta(result: SpeechSDK.SpeechRecognitionResult, source: "partial" | "final"): AzureTranscriptMeta {
    const meta: AzureTranscriptMeta = {
      ...this.lastChunkMeta,
      source,
    };
    const durationRaw = Number((result as any)?.duration || 0);
    const offsetRaw = Number((result as any)?.offset || 0);
    if (Number.isFinite(durationRaw) && durationRaw > 0) meta.durationMs = Math.round(durationRaw / 10_000);
    if (Number.isFinite(offsetRaw) && offsetRaw > 0) meta.offsetMs = Math.round(offsetRaw / 10_000);

    const jsonRaw = typeof (result as any)?.json === "string" ? String((result as any).json) : "";
    if (jsonRaw) {
      try {
        const parsed = JSON.parse(jsonRaw);
        const nBest = Array.isArray(parsed?.NBest) ? parsed.NBest : [];
        const top = nBest[0] || {};
        const confidence = Number(top?.Confidence);
        if (Number.isFinite(confidence)) meta.confidence = confidence;
        const locale = parsed?.PrimaryLanguage?.Language || parsed?.Language || parsed?.Locale;
        if (typeof locale === "string" && locale.trim()) meta.language = locale.trim();
      } catch {
        // ignore malformed Azure JSON payloads
      }
    }

    return meta;
  }

  async startFromMic(): Promise<void> {
    this.intentionalStop = false;
    this.callbacks.onStatusChange("connecting");
    this.startMode = "mic";
    this.sourceStream = null;
    this.sourceStreams = [];
    const speechConfig = await this.createSpeechConfigFromFreshToken();

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
    this.intentionalStop = false;
    this.callbacks.onStatusChange("connecting");
    this.startMode = "mixed";
    this.sourceStream = null;
    this.sourceStreams = streams.slice();
    const speechConfig = await this.createSpeechConfigFromFreshToken();
    this.setupMixedAudioPipeline(streams, speechConfig);
  }

  async startFromStream(mediaStream: MediaStream): Promise<void> {
    this.intentionalStop = false;
    this.callbacks.onStatusChange("connecting");
    this.startMode = "stream";
    this.sourceStream = mediaStream;
    this.sourceStreams = [];
    const speechConfig = await this.createSpeechConfigFromFreshToken();
    this.setupSingleStreamAudioPipeline(mediaStream, speechConfig);
  }

  private setupMixedAudioPipeline(streams: MediaStream[], speechConfig: SpeechSDK.SpeechConfig) {
    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    this.audioStream = SpeechSDK.AudioInputStream.createPushStream(format);
    this.audioSampleRate = 16000;
    this.maxPreRollSamples = Math.round(this.audioSampleRate * Math.max(0.1, Math.min(1.0, (this.options.preRollMs ?? 420) / 1000)));
    this.resetAudioState();

    this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    const destination = this.audioContext.createMediaStreamDestination();
    destination.channelCount = 1;
    destination.channelCountMode = "explicit";

    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    for (const stream of streams) {
      if (stream.getAudioTracks().length === 0) continue;
      const source = this.audioContext.createMediaStreamSource(stream);
      const gain = this.audioContext.createGain();
      gain.gain.value = 0.5;
      source.connect(gain);
      gain.connect(compressor);
    }

    compressor.connect(destination);
    const mergedSource = this.audioContext.createMediaStreamSource(destination.stream);
    this.setupWorkletOrProcessor(mergedSource, this.options.vadNoiseFloor ?? 0.014);

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(this.audioStream);
    this.setupRecognizer(speechConfig, audioConfig);
  }

  private setupSingleStreamAudioPipeline(mediaStream: MediaStream, speechConfig: SpeechSDK.SpeechConfig) {
    const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
    this.audioStream = SpeechSDK.AudioInputStream.createPushStream(format);
    this.audioSampleRate = 16000;
    this.maxPreRollSamples = Math.round(this.audioSampleRate * Math.max(0.1, Math.min(1.0, (this.options.preRollMs ?? 420) / 1000)));
    this.resetAudioState();

    this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
    const source = this.audioContext.createMediaStreamSource(mediaStream);
    this.setupWorkletOrProcessor(source, this.options.vadNoiseFloor ?? 0.015);

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(this.audioStream);
    this.setupRecognizer(speechConfig, audioConfig);
  }

  private setupWorkletOrProcessor(source: MediaStreamAudioSourceNode, noiseFloor: number) {
    if (this.audioContext?.audioWorklet) {
      void this.audioContext.audioWorklet.addModule("/pcm-processor.js").then(() => {
        if (!this.audioContext || !this.running || !this.audioStream) return;
        const workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
        workletNode.port.postMessage({
          noiseFloor,
          targetRms: this.options.targetRms ?? 0.12,
          maxGain: this.options.maxGain ?? 4,
          limiter: this.options.clippingThreshold ?? 0.92,
          silenceHoldFrames: this.options.silenceHoldFrames ?? 8,
          preRollFrames: this.options.preRollFrames ?? 5,
        });
        workletNode.port.onmessage = (ev: MessageEvent) => {
          if (!this.audioStream || !this.running) return;
          // pcm-processor.js sends raw ArrayBuffer; older format sends { pcm, rms, isSpeech }
          const pcmData: ArrayBuffer | undefined =
            ev.data instanceof ArrayBuffer ? ev.data : (ev.data?.pcm as ArrayBuffer | undefined);
          if (!pcmData) return;
          const buffer = new Int16Array(pcmData);
          const payload = ev.data instanceof ArrayBuffer ? {} : (ev.data || {});
          this.writeChunkToAzure(buffer, {
            rms: typeof payload.rms === "number" ? payload.rms : undefined,
            isSpeech: payload.isSpeech !== false,
            noiseLikely: !!payload.noiseLikely,
            source: "partial",
          });
        };
        source.connect(workletNode);
        workletNode.connect(this.audioContext.destination);
        this.processorNode = workletNode;
      }).catch(() => {
        this.setupScriptProcessor(source);
      });
      return;
    }
    this.setupScriptProcessor(source);
  }

  private setupScriptProcessor(source: MediaStreamAudioSourceNode) {
    const processor = this.audioContext!.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (ev) => {
      if (!this.audioStream || !this.running) return;
      const inputData = ev.inputBuffer.getChannelData(0);
      const { pcm16, meta } = this.preprocessFloatChunk(inputData);
      this.writeChunkToAzure(pcm16, meta);
    };
    source.connect(processor);
    processor.connect(this.audioContext!.destination);
    this.processorNode = processor as any;
  }

  private setupRecognizer(speechConfig: SpeechSDK.SpeechConfig, audioConfig: SpeechSDK.AudioConfig) {
    this.recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);
    this.running = true;
    this.intentionalStop = false;
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
        this.callbacks.onPartial(text, this.buildAzureMeta(event.result, "partial"));
      }
    };

    this.recognizer.recognized = (_sender, event) => {
      if (!this.running) return;
      if (event.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
        const text = event.result.text?.trim();
        if (text) {
          // Final transcript commits come only from Azure recognized events.
          this.callbacks.onFinal(text, this.buildAzureMeta(event.result, "final"));
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
        this.scheduleRecognizerRestart("canceled");
      }
    };

    this.recognizer.sessionStarted = () => {
      this.restartAttempts = 0;
      this.callbacks.onStatusChange("connected");
    };

    this.recognizer.sessionStopped = () => {
      if (this.running) {
        // scheduleRecognizerRestart fires "connecting" — skip "disconnected" so the
        // outer reconnect logic (meeting-session.tsx) does not also kick off a restart.
        this.scheduleRecognizerRestart("session stopped");
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
    this.intentionalStop = true;
    this.running = false;
    this.clearLifecycleTimers();

    if (this.recognizer) {
      this.recognizer.stopContinuousRecognitionAsync(
        () => {
          this.cleanupRecognitionResources();
        },
        (err) => {
          console.error("[AzureRecognizer] Stop error:", err);
          this.cleanupRecognitionResources();
        },
      );
    } else {
      this.cleanupRecognitionResources();
    }
    this.callbacks.onStatusChange("disconnected");
  }

  isRunning(): boolean {
    return this.running;
  }

  async restart(): Promise<void> {
    if (!this.running || this.intentionalStop) return;
    this.clearLifecycleTimers();
    await this.restartFromLastSource();
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
