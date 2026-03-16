import * as THREE from 'three';

const FLUORESCENT_CYAN = 0x00ffcc;

/**
 * Middle layer: static minimal wireframe square as the core container.
 */
export function createSquareFrame(size = 0.5) {
  const half = size / 2;
  const points = [
    new THREE.Vector3(-half, -half, 0),
    new THREE.Vector3(half, -half, 0),
    new THREE.Vector3(half, half, 0),
    new THREE.Vector3(-half, half, 0),
    new THREE.Vector3(-half, -half, 0),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: FLUORESCENT_CYAN,
    linewidth: 1,
  });
  const line = new THREE.Line(geometry, material);
  return line;
}
