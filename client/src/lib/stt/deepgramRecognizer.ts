export interface DeepgramRecognizerCallbacks {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: "connecting" | "connected" | "disconnected" | "error") => void;
}

export interface DeepgramRecognizerOptions {
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

type TokenResponse = {
  token: string;
  expires_in_seconds: number;
};

async function fetchDeepgramToken(): Promise<TokenResponse> {
  const response = await fetch("/api/speech/deepgram/token", { credentials: "include" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to get Deepgram token" }));
    throw new Error(`${error.message || "Failed to get Deepgram token"} (status=${response.status})`);
  }

  return response.json();
}

function toDeepgramLanguage(language: string | undefined): string {
  const normalized = String(language || "en-US").trim();
  const exactMap: Record<string, string> = {
    "hi-IN": "hi",
    "es-ES": "es",
    "fr-FR": "fr",
    "de-DE": "de",
    "zh-CN": "zh",
    "ja-JP": "ja",
    "ko-KR": "ko",
    "pt-BR": "pt-BR",
    "ar-SA": "ar",
    "te-IN": "te",
    "ta-IN": "ta",
    "bn-IN": "bn",
    "mr-IN": "mr",
    "gu-IN": "gu",
    "kn-IN": "kn",
    "ml-IN": "ml",
  };

  return exactMap[normalized] || normalized;
}

function buildDeepgramUrl(token: string, options: DeepgramRecognizerOptions): string {
  const params = new URLSearchParams({
    model: "nova-3",
    language: toDeepgramLanguage(options.language),
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    vad_events: "true",
    endpointing: String(options.silenceTimeoutMs || 600),
    utterance_end_ms: String(Math.max(1000, (options.silenceTimeoutMs || 600) + 400)),
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    token,
  });

  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

export class DeepgramRecognizer {
  private ws: WebSocket | null = null;
  private callbacks: DeepgramRecognizerCallbacks;
  private options: DeepgramRecognizerOptions;
  private running = false;
  private processorNode: ScriptProcessorNode | AudioWorkletNode | null = null;
  private audioContext: AudioContext | null = null;
  private keepAliveTimer: number | null = null;

  constructor(callbacks: DeepgramRecognizerCallbacks, options: DeepgramRecognizerOptions = {}) {
    this.callbacks = callbacks;
    this.options = {
      language: options.language || "en-US",
      silenceTimeoutMs: options.silenceTimeoutMs || 600,
      phraseHints: options.phraseHints || [],
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
      const sample = Math.max(-1, Math.min(1, processed));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return pcm16;
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = window.setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 4000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer !== null) {
      window.clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private sendAudio(pcmBuffer: ArrayBuffer) {
    if (!this.running || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcmBuffer);
  }

  private async handleSocketMessage(data: string | ArrayBuffer | Blob) {
    let textPayload = "";
    if (typeof data === "string") {
      textPayload = data;
    } else if (data instanceof Blob) {
      textPayload = await data.text();
    } else {
      textPayload = new TextDecoder().decode(data);
    }

    if (!textPayload) return;

    let payload: any;
    try {
      payload = JSON.parse(textPayload);
    } catch {
      return;
    }

    if (payload?.type === "Results") {
      const transcript = String(payload.channel?.alternatives?.[0]?.transcript || "").trim();
      if (!transcript) return;
      if (payload.is_final) {
        this.callbacks.onFinal(transcript);
      } else {
        this.callbacks.onPartial(transcript);
      }
      return;
    }

    if (payload?.type === "Error") {
      const message = String(payload.description || payload.message || "Deepgram transcription error");
      this.callbacks.onError(message);
      this.callbacks.onStatusChange("error");
    }
  }

  private async openWebSocket(): Promise<void> {
    this.callbacks.onStatusChange("connecting");
    const tokenData = await fetchDeepgramToken();
    const url = buildDeepgramUrl(tokenData.token, this.options);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      let opened = false;
      this.ws = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        opened = true;
        this.running = true;
        this.startKeepAlive();
        this.callbacks.onStatusChange("connected");
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onerror = () => {
        const error = new Error("Deepgram WebSocket connection failed");
        if (!settled) {
          settled = true;
          reject(error);
          return;
        }
        if (this.running) {
          this.callbacks.onError(error.message);
          this.callbacks.onStatusChange("error");
        }
      };

      ws.onmessage = (event) => {
        void this.handleSocketMessage(event.data);
      };

      ws.onclose = (event) => {
        this.stopKeepAlive();
        if (!opened && !settled) {
          settled = true;
          reject(new Error(`Deepgram WebSocket closed before opening (code=${event.code})`));
          return;
        }
        if (!this.running) return;
        this.running = false;
        this.callbacks.onStatusChange("disconnected");
      };
    });
  }

  private async setupAudioPipeline(source: MediaStreamAudioSourceNode) {
    if (!this.audioContext) return;

    const sink = this.audioContext.createGain();
    sink.gain.value = 0;

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
        workletNode.port.onmessage = (event: MessageEvent) => {
          this.sendAudio(event.data as ArrayBuffer);
        };
        source.connect(workletNode);
        workletNode.connect(sink);
        sink.connect(this.audioContext.destination);
        this.processorNode = workletNode;
        return;
      } catch {
        // Fall back to ScriptProcessor below.
      }
    }

    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!this.running) return;
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = this.preprocessFloatChunk(inputData);
      this.sendAudio(pcm16.buffer);
    };
    source.connect(processor);
    processor.connect(sink);
    sink.connect(this.audioContext.destination);
    this.processorNode = processor;
  }

  async startFromStream(mediaStream: MediaStream): Promise<void> {
    await this.openWebSocket();
    try {
      this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      const source = this.audioContext.createMediaStreamSource(mediaStream);
      await this.setupAudioPipeline(source);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  async startFromMixedStreams(streams: MediaStream[]): Promise<void> {
    await this.openWebSocket();
    try {
      this.audioContext = new AudioContext({ sampleRate: 16000, latencyHint: "interactive" });
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      const destination = this.audioContext.createMediaStreamDestination();
      for (const stream of streams) {
        if (stream.getAudioTracks().length === 0) continue;
        const source = this.audioContext.createMediaStreamSource(stream);
        const gain = this.audioContext.createGain();
        gain.gain.value = 1.2;
        source.connect(gain);
        gain.connect(destination);
      }

      const mergedSource = this.audioContext.createMediaStreamSource(destination.stream);
      await this.setupAudioPipeline(mergedSource);
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.running = false;
    this.stopKeepAlive();

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "CloseStream" }));
        }
        this.ws.close();
      } catch {
        // Ignore close errors during teardown.
      }
      this.ws = null;
    }

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch {
        // Ignore close errors during teardown.
      }
      this.audioContext = null;
    }

    this.processorNode = null;
    this.callbacks.onStatusChange("disconnected");
  }

  isRunning(): boolean {
    return this.running;
  }
}
