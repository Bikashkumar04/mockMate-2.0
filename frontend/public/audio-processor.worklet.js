/**
 * audio-processor.worklet.js
 * ──────────────────────────
 * AudioWorkletProcessor that captures raw microphone input and converts it
 * to 16-bit signed PCM (little-endian) at the stream's native sample rate.
 * The main thread resamples to 16 kHz before sending to the WebSocket.
 *
 * Usage (main thread):
 *   await audioCtx.audioWorklet.addModule('/audio-processor.worklet.js');
 *   const node = new AudioWorkletNode(audioCtx, 'pcm-capture-processor');
 *   node.port.onmessage = (e) => sendPCM(e.data); // ArrayBuffer of Int16
 *   micStreamSource.connect(node);
 */

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Accumulate ~100 ms of frames before flushing (reduces WS overhead). */
    this._bufferSize = 1600; // frames @ 16 kHz = 100 ms; scales with sampleRate
    this._buffer = [];
    this._frameCount = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono (or left channel)

    for (let i = 0; i < channelData.length; i++) {
      // Float32 [-1, 1] → Int16 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      this._buffer.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
      this._frameCount++;

      if (this._frameCount >= this._bufferSize) {
        this._flush();
      }
    }

    return true; // keep processor alive
  }

  _flush() {
    const int16 = new Int16Array(this._buffer);
    // Transfer ownership of the underlying ArrayBuffer (zero-copy)
    this.port.postMessage(int16.buffer, [int16.buffer]);
    this._buffer = [];
    this._frameCount = 0;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
