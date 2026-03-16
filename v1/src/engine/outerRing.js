import * as THREE from 'three';

const FLUORESCENT_CYAN = 0x00ffcc;

/**
 * Outer ring: thin fluorescent cyan (#00FFCC) circle.
 * Vertex count chosen for audio frequency mapping (analyser.getByteFrequencyData).
 * Stage 2: vertices driven by audio radial displacement (inward/outward).
 */
export function createOuterRing(radius = 1.2, segments = 128) {
  const curve = new THREE.EllipseCurve(0, 0, radius, radius, 0, 2 * Math.PI, false, 0);
  const points = curve.getPoints(segments);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: FLUORESCENT_CYAN,
    linewidth: 1,
  });
  const line = new THREE.Line(geometry, material);
  line.rotation.x = Math.PI / 2;

  const baseRadius = radius;
  const positionAttr = geometry.getAttribute('position');

  /**
   * Update ring vertices from frequency data. Each vertex gets radial displacement.
   * @param {Uint8Array} frequencyData - from analyser.getByteFrequencyData()
   * @param {number} gain - scale factor for displacement (default 0.15)
   */
  function updateFromFrequencyData(frequencyData, gain = 0.15) {
    if (!frequencyData || frequencyData.length === 0) return;
    const n = positionAttr.count;
    const binSize = Math.floor(frequencyData.length / n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      const start = i * binSize;
      for (let k = 0; k < binSize && start + k < frequencyData.length; k++) {
        sum += frequencyData[start + k];
      }
      const avg = binSize > 0 ? sum / binSize : 0;
      const t = (i / n) * Math.PI * 2;
      const r = baseRadius + (avg / 255) * gain;
      positionAttr.setXYZ(i, Math.cos(t) * r, Math.sin(t) * r, 0);
    }
    positionAttr.needsUpdate = true;
  }

  return { line, geometry, segments, updateFromFrequencyData };
}
