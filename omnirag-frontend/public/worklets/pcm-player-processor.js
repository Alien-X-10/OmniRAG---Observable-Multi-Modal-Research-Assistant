// File: omnirag-frontend/public/worklets/pcm-player-processor.js
const SOURCE_SAMPLE_RATE = 24000;
const RING_CAPACITY = SOURCE_SAMPLE_RATE * 30; // 30-second Float32 circular ring buffer

class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_CAPACITY);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedSamples = 0;
    this.readFrac = 0;
    this.stepRatio = SOURCE_SAMPLE_RATE / sampleRate;

    this.isPlaying = false;
    this.silenceQuanta = 0;
    this.SILENCE_HOLD_QUANTA = Math.ceil((0.15 * sampleRate) / 128); // 150 ms jitter grace

    this.port.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'FLUSH') {
        this.flush();
      } else if (msg.type === 'PCM_24K' && msg.buffer) {
        this.enqueueInt16(new Int16Array(msg.buffer));
      }
    };
  }

  flush() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedSamples = 0;
    this.readFrac = 0;
    this.silenceQuanta = 0;
    this.ring.fill(0);
    if (this.isPlaying) {
      this.isPlaying = false;
      this.port.postMessage({ type: 'playback_state', playing: false });
    }
  }

  enqueueInt16(int16Data) {
    for (let i = 0; i < int16Data.length; i++) {
      this.ring[this.writeIndex] = int16Data[i] / 32768.0;
      this.writeIndex = (this.writeIndex + 1) % RING_CAPACITY;
      if (this.bufferedSamples < RING_CAPACITY) {
        this.bufferedSamples += 1;
      } else {
        // Overwrite oldest sample if ring overflows
        this.readIndex = (this.readIndex + 1) % RING_CAPACITY;
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs?.[0]?.[0];
    if (!out) return true;

    let producedAudio = false;

    for (let i = 0; i < out.length; i++) {
      if (this.bufferedSamples >= 2) {
        const s0 = this.ring[this.readIndex];
        const s1 = this.ring[(this.readIndex + 1) % RING_CAPACITY];
        out[i] = s0 + (s1 - s0) * this.readFrac;
        producedAudio = true;

        this.readFrac += this.stepRatio;
        const advance = Math.floor(this.readFrac);
        if (advance > 0) {
          this.readFrac -= advance;
          const step = Math.min(advance, this.bufferedSamples);
          this.readIndex = (this.readIndex + step) % RING_CAPACITY;
          this.bufferedSamples -= step;
        }
      } else if (this.bufferedSamples === 1) {
        out[i] = this.ring[this.readIndex];
        producedAudio = true;
        this.readFrac += this.stepRatio;
        if (this.readFrac >= 1) {
          this.readFrac = 0;
          this.readIndex = (this.readIndex + 1) % RING_CAPACITY;
          this.bufferedSamples = 0;
        }
      } else {
        out[i] = 0;
      }
    }

    if (producedAudio) {
      this.silenceQuanta = 0;
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.port.postMessage({ type: 'playback_state', playing: true });
      }
    } else if (this.isPlaying) {
      this.silenceQuanta += 1;
      if (this.silenceQuanta >= this.SILENCE_HOLD_QUANTA) {
        this.isPlaying = false;
        this.port.postMessage({ type: 'playback_state', playing: false });
      }
    }

    return true;
  }
}

registerProcessor('pcm-player-processor', PcmPlayerProcessor);