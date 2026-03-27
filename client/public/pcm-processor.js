class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    this._targetSamples = 64;
    this._noiseFloor = 0.006;
    this._targetRms = 0.12;
    this._maxGain = 4.0;
    this._limiter = 0.92;
    this._silenceHoldFrames = 20; // ~80ms hold after speech ends — prevents last-word cutoff
    this._preRollFrames = 15;     // ~60ms pre-roll before speech onset — prevents first-word cutoff
    this._silentFrames = 0;
    this._isSpeaking = false;
    this._preRollBuf = [];        // ring buffer of recent PCM16 ArrayBuffers (not yet sent)

    this.port.onmessage = (event) => {
      const data = event?.data || {};
      if (typeof data.noiseFloor === "number") this._noiseFloor = Math.max(0.002, Math.min(0.08, data.noiseFloor));
      if (typeof data.targetRms === "number") this._targetRms = Math.max(0.04, Math.min(0.3, data.targetRms));
      if (typeof data.maxGain === "number") this._maxGain = Math.max(1, Math.min(8, data.maxGain));
      if (typeof data.limiter === "number") this._limiter = Math.max(0.6, Math.min(0.98, data.limiter));
      if (typeof data.silenceHoldFrames === "number") this._silenceHoldFrames = Math.max(0, Math.min(60, data.silenceHoldFrames | 0));
      if (typeof data.preRollFrames === "number") this._preRollFrames = Math.max(0, Math.min(30, data.preRollFrames | 0));
    };
  }

  _toFloat(chunk) {
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < chunk.length; i++) {
      const abs = Math.abs(chunk[i]);
      if (abs > peak) peak = abs;
      sumSq += chunk[i] * chunk[i];
    }
    const rms = Math.sqrt(sumSq / Math.max(1, chunk.length));

    const desiredGain = rms > 0.0001 ? this._targetRms / rms : this._maxGain;
    const gain = Math.max(0.9, Math.min(this._maxGain, desiredGain));
    const out = new Float32Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      let s = chunk[i] * gain;
      if (Math.abs(s) > this._limiter) s = Math.sign(s) * this._limiter;
      out[i] = s;
    }
    if (peak > 0.98) {
      for (let i = 0; i < out.length; i++) out[i] *= 0.92;
    }
    return { rms, out };
  }

  _toPcm16(floatData) {
    const pcm16 = new Int16Array(floatData.length);
    for (let i = 0; i < floatData.length; i++) {
      const s = Math.max(-1, Math.min(1, floatData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }

  _preprocessChunk(chunk) {
    const { rms, out } = this._toFloat(chunk);
    const pcm16 = this._toPcm16(out);

    if (rms >= this._noiseFloor) {
      // ── Speech active ──
      if (!this._isSpeaking) {
        // Onset: flush pre-roll so the first word's attack is included
        this._isSpeaking = true;
        for (const buf of this._preRollBuf) {
          this.port.postMessage(buf, [buf]);
        }
        this._preRollBuf = [];
      }
      this._silentFrames = 0;
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    } else {
      // ── Below noise floor ──
      this._silentFrames++;

      if (this._isSpeaking && this._silentFrames <= this._silenceHoldFrames) {
        // Hold period: keep sending so the last word isn't clipped
        this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      } else {
        // Truly silent: switch to pre-roll buffering
        if (this._silentFrames > this._silenceHoldFrames) {
          this._isSpeaking = false;
        }
        // Store actual audio in pre-roll ring (not zeros) so onset flush is real speech
        this._preRollBuf.push(pcm16.buffer.slice(0));
        if (this._preRollBuf.length > this._preRollFrames) {
          this._preRollBuf.shift();
        }
        // Send zeros to Azure during silence
        const zeros = new Int16Array(chunk.length);
        this.port.postMessage(zeros.buffer, [zeros.buffer]);
      }
    }
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channelData = input[0];
    if (!channelData || channelData.length === 0) return true;

    for (let i = 0; i < channelData.length; i++) {
      this._buffer.push(channelData[i]);
    }
    this._bufferSize += channelData.length;

    while (this._bufferSize >= this._targetSamples) {
      const chunk = this._buffer.splice(0, this._targetSamples);
      this._bufferSize -= this._targetSamples;
      this._preprocessChunk(chunk);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
