export interface WsMicStreamerOptions {
  meetingId: string;
  sampleRate?: number;
  silenceMs?: number;
  confidenceThreshold?: number;
  vadNoiseFloor?: number;
  targetRms?: number;
  maxGain?: number;
  clippingThreshold?: number;
  silenceHoldFrames?: number;
  onPartial?: (text: string, confidence: number) => void;
  onFinal?: (text: string, turnIndex: number, confidence: number) => void;
  onQuestionDetected?: (data: { cleanQuestion: string; questionType: string; confidence: number; turnIndex: number }) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
}

export class WsMicStreamer {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private options: WsMicStreamerOptions;
  private reconnectAttempts = 0;
  private maxReconnects = 5;
  private destroyed = false;

  constructor(options: WsMicStreamerOptions) {
    this.options = {
      vadNoiseFloor: 0.015,
      targetRms: 0.12,
      maxGain: 4,
      clippingThreshold: 0.92,
      silenceHoldFrames: 2,
      ...options,
    };
  }

  private preprocessFloatChunk(input: Float32Array): Int16Array {
    const noiseFloor = Math.max(0.002, Math.min(0.08, this.options.vadNoiseFloor ?? 0.015));
    const targetRms = Math.max(0.04, Math.min(0.3, this.options.targetRms ?? 0.12));
    const maxGain = Math.max(1, Math.min(8, this.options.maxGain ?? 4));
    const clippingThreshold = Math.max(0.6, Math.min(0.98, this.options.clippingThreshold ?? 0.92));
    const gate = noiseFloor * 0.65;

    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, input.length));
    const pcm16 = new Int16Array(input.length);
    if (rms < noiseFloor) {
      pcm16.fill(0);
      return pcm16;
    }

    const desiredGain = rms > 0.0001 ? targetRms / rms : maxGain;
    const gain = Math.max(0.9, Math.min(maxGain, desiredGain));

    for (let i = 0; i < input.length; i++) {
      const raw = Math.abs(input[i]) < gate ? 0 : input[i];
      let processed = raw * gain;
      if (Math.abs(processed) > clippingThreshold) {
        processed = Math.sign(processed) * clippingThreshold;
      }
      if (peak > 0.98) processed *= 0.92;
      const s = Math.max(-1, Math.min(1, processed));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  async start(existingStream?: MediaStream): Promise<void> {
    try {
      this.stream = existingStream || await navigator.mediaDevices.getUserMedia({ audio: true });

      this.connectWebSocket();

      this.audioContext = new AudioContext({ sampleRate: 16000 });

      try {
        await this.audioContext.audioWorklet.addModule("/pcm-processor.js");
        const source = this.audioContext.createMediaStreamSource(this.stream);
        this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-processor");
        this.workletNode.port.postMessage({
          noiseFloor: this.options.vadNoiseFloor ?? 0.015,
          targetRms: this.options.targetRms ?? 0.12,
          maxGain: this.options.maxGain ?? 4,
          limiter: this.options.clippingThreshold ?? 0.92,
          silenceHoldFrames: this.options.silenceHoldFrames ?? 2,
        });

        this.workletNode.port.onmessage = (event) => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(event.data);
          }
        };

        source.connect(this.workletNode);
        this.workletNode.connect(this.audioContext.destination);
      } catch {
        console.warn("[WsMicStreamer] AudioWorklet not supported, using ScriptProcessor fallback");
        this.setupScriptProcessorFallback(this.stream);
      }
    } catch (err: any) {
      this.options.onError?.(`Failed to start audio: ${err.message}`);
      throw err;
    }
  }

  private setupScriptProcessorFallback(stream: MediaStream): void {
    if (!this.audioContext) return;

    const source = this.audioContext.createMediaStreamSource(stream);
    const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const pcm16 = this.preprocessFloatChunk(input);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(pcm16.buffer);
      }
    };

    source.connect(processor);
    processor.connect(this.audioContext.destination);
  }

  private connectWebSocket(): void {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      sessionId: this.options.meetingId,
      silenceMs: String(this.options.silenceMs || 500),
      confidenceThreshold: String(this.options.confidenceThreshold || 0.65),
    });
    const url = `${protocol}//${window.location.host}/ws/stt?${params}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.options.onConnected?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "stt_partial":
            this.options.onPartial?.(msg.text, msg.confidence);
            break;
          case "stt_final":
            this.options.onFinal?.(msg.text, msg.turnIndex, msg.confidence);
            break;
          case "question_detected":
            this.options.onQuestionDetected?.({
              cleanQuestion: msg.cleanQuestion,
              questionType: msg.questionType,
              confidence: msg.confidence,
              turnIndex: msg.turnIndex,
            });
            break;
          case "error":
            this.options.onError?.(msg.message || "Unknown error");
            break;
        }
      } catch {}
    };

    this.ws.onclose = () => {
      if (!this.destroyed && this.reconnectAttempts < this.maxReconnects) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectWebSocket(), 1000 * this.reconnectAttempts);
      }
    };

    this.ws.onerror = () => {
      this.options.onError?.("WebSocket connection error");
    };
  }

  sendConfig(config: { silenceMs?: number; confidenceThreshold?: number }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "config", ...config }));
    }
  }

  stop(): void {
    this.destroyed = true;
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
