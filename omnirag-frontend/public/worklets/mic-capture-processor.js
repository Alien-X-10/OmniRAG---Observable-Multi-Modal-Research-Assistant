// File: omnirag-frontend/public/worklets/mic-capture-processor.js
const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 512; // 32 ms at 16 kHz

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.srcPos = 0;
    this.prevSample = 0;

    this.outBuffer = new Int16Array(CHUNK_SAMPLES);
    this.outIndex = 0;

    this.muted = false;
    this.vadThreshold = 0.028;
    this.minSpeechFrames = 3; // ~8-10 ms debounce to reject single clicks
    this.speechFrames = 0;
    this.vadCooldownMs = 450;
    this.lastVadTriggerTime = 0;

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'SET_MUTED') {
        this.muted = Boolean(msg.muted);
      } else if (msg.type === 'SET_VAD_THRESHOLD' && typeof msg.threshold === 'number') {
        this.vadThreshold = msg.threshold;
      }
    };
  }

  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (!channel || channel.length === 0) return true;
    if (this.muted) {
      this.speechFrames = 0;
      return true;
    }

    // 1. Local RMS Voice Activity Detection (triggers instant barge-in while agent speaks)
    let sumSq = 0;
    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / channel.length);

    if (rms >= this.vadThreshold) {
      this.speechFrames += 1;
      const nowMs = currentTime * 1000;
      if (
        this.speechFrames >= this.minSpeechFrames &&
        nowMs - this.lastVadTriggerTime >= this.vadCooldownMs
      ) {
        this.lastVadTriggerTime = nowMs;
        this.port.postMessage({ type: 'vad_speech_start', rms });
      }
    } else {
      this.speechFrames = 0;
    }

    // 2. Continuous linear downsampling from native sampleRate -> 16 kHz Int16 PCM
    const len = channel.length;
    while (this.srcPos < len) {
      const idx = Math.floor(this.srcPos);
      const frac = this.srcPos - idx;
      const s0 = idx === 0 ? this.prevSample : channel[idx - 1];
      const s1 = channel[idx];
      const interp = s0 + (s1 - s0) * frac;

      const clamped = Math.max(-1, Math.min(1, interp));
      this.outBuffer[this.outIndex++] =
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);

      if (this.outIndex >= CHUNK_SAMPLES) {
        const chunkCopy = new Int16Array(this.outBuffer);
        this.port.postMessage({ type: 'pcm', buffer: chunkCopy.buffer }, [
          chunkCopy.buffer,
        ]);
        this.outIndex = 0;
      }

      this.srcPos += this.ratio;
    }

    this.prevSample = channel[len - 1];
    this.srcPos -= len;
    return true;
  }
}

registerProcessor('mic-capture-processor', MicCaptureProcessor);