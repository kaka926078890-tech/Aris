/**
 * Web Audio API: AnalyserNode for spectrum data.
 * Provides getByteFrequencyData for the outer ring waveform.
 * Source can be TTS playback (stage 3) or test oscillator (stage 2).
 */
let audioContext = null;
let analyser = null;
let frequencyData = null;
let sourceNode = null;

export function getAudioAnalyser() {
  if (analyser && frequencyData) return { analyser, frequencyData };
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    frequencyData = new Uint8Array(analyser.frequencyBinCount);
    return { analyser, frequencyData };
  } catch (e) {
    console.warn('Web Audio not available', e);
    return null;
  }
}

/**
 * Connect a test oscillator so the ring has motion when no TTS is playing.
 * Call connectTTSSource(mediaStream or audioNode) later for real TTS.
 */
export function connectTestOscillator() {
  const a = getAudioAnalyser();
  if (!a || !audioContext) return;
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (_) {}
  }
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  gain.gain.value = 0.15;
  osc.connect(gain);
  gain.connect(analyser);
  osc.start(0);
  sourceNode = osc;
}

/**
 * Connect an external source (e.g. TTS playback) to the analyser.
 * @param {AudioNode} node - AudioNode to connect (e.g. source from AudioContext.createMediaElementSource)
 */
export function connectSource(node) {
  const a = getAudioAnalyser();
  if (!a) return;
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (_) {}
  }
  node.connect(analyser);
  sourceNode = node;
}

export function getFrequencyData() {
  if (!analyser || !frequencyData) return null;
  analyser.getByteFrequencyData(frequencyData);
  return frequencyData;
}
