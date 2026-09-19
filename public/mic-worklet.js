// Collects microphone samples, downsamples to 24 kHz and posts PCM16 frames.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 24000;
    this.buffer = [];
    this.carry = 0;
    this.frame = 2400; // 100 ms at 24 kHz
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    // Linear resample from the context rate to 24 kHz.
    let pos = this.carry;
    while (pos < input.length - 1) {
      const i = Math.floor(pos);
      const frac = pos - i;
      this.buffer.push(input[i] * (1 - frac) + input[i + 1] * frac);
      pos += this.ratio;
    }
    this.carry = pos - (input.length - 1);

    while (this.buffer.length >= this.frame) {
      const chunk = this.buffer.splice(0, this.frame);
      const pcm = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("mic-capture", MicCapture);
