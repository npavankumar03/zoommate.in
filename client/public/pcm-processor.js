class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    this._targetSamples = 64;
    this._noiseFloor = 0.008;
    this._targetRms = 0.12;
    this._maxGain = 4.0;
    this._limiter = 0.92;
    this._silenceHoldFrames = 3;
    this._silentFrames = 0;

    this.port.onmessage = (event) => {
      const data = event?.data || {};
      if (typeof data.noiseFloor === "number") this._noiseFloor = Math.max(0.002, Math.min(0.08, data.noiseFloor));
      if (typeof data.targetRms === "number") this._targetRms = Math.max(0.04, Math.min(0.3, data.targetRms));
      if (typeof data.maxGain === "number") this._maxGain = Math.max(1, Math.min(8, data.maxGain));
      if (typeof data.limiter === "number") this._limiter = Math.max(0.6, Math.min(0.98, data.limiter));
      if (typeof data.silenceHoldFrames === "number") this._silenceHoldFrames = Math.max(0, Math.min(8, data.silenceHoldFrames | 0));
    };
  }

  _preprocessChunk(chunk) {
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < chunk.length; i++) {
      const sample = chunk[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sumSq += sample * sample;
    }

    const rms = Math.sqrt(sumSq / Math.max(1, chunk.length));
    if (rms < this._noiseFloor) {
      this._silentFrames += 1;
      if (this._silentFrames > this._silenceHoldFrames) {
        return new Float32Array(chunk.length);
      }
    } else {
      this._silentFrames = 0;
    }

    const desiredGain = rms > 0.0001 ? this._targetRms / rms : this._maxGain;
    const gain = Math.max(0.9, Math.min(this._maxGain, desiredGain));
    const out = new Float32Array(chunk.length);

    for (let i = 0; i < chunk.length; i++) {
      let processed = chunk[i] * gain;
      if (Math.abs(processed) > this._limiter) {
        processed = Math.sign(processed) * this._limiter;
      }
      out[i] = processed;
    }

    if (peak > 0.98) {
      for (let i = 0; i < out.length; i++) {
        out[i] *= 0.92;
      }
    }

    return out;
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
      const processed = this._preprocessChunk(chunk);
      const pcm16 = new Int16Array(processed.length);
      for (let i = 0; i < processed.length; i++) {
        const s = Math.max(-1, Math.min(1, processed[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
