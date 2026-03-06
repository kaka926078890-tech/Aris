import * as THREE from 'three';

const PARTICLE_COLOR = 0x00ffff;
const WIREFRAME_COLOR = 0x0088ff;
const PULSE_COLOR = 0x00ffff;

/**
 * 发光球体 + 中心脉冲（无底部圆环）
 * - 节点较少 IcosahedronGeometry(1, 1)
 * - 呼吸频率降低
 */
function generatePulseTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createPlexus() {
  const group = new THREE.Group();

  const geometry = new THREE.IcosahedronGeometry(1, 1);

  // 1. 节点 (Points)
  const pointsMat = new THREE.PointsMaterial({
    color: PARTICLE_COLOR,
    size: 0.015,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, pointsMat);
  group.add(points);

  // 2. 线框 (Wireframe)
  const wireframeMat = new THREE.LineBasicMaterial({
    color: WIREFRAME_COLOR,
    transparent: true,
    opacity: 0.3,
    blending: THREE.AdditiveBlending,
  });
  const wireframe = new THREE.LineSegments(
    new THREE.WireframeGeometry(geometry),
    wireframeMat
  );
  group.add(wireframe);

  // 3. 中心脉冲平面
  const pulseGeom = new THREE.PlaneGeometry(0.4, 0.4);
  const pulseMat = new THREE.MeshBasicMaterial({
    color: PULSE_COLOR,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8,
    map: generatePulseTexture(),
  });
  const pulse = new THREE.Mesh(pulseGeom, pulseMat);
  group.add(pulse);

  function drift(delta, timeSec = 0) {
    const time = timeSec;

    // 球体自转
    points.rotation.y += 0.002;
    wireframe.rotation.y += 0.002;

    // 顶点微调 (呼吸感，频率降低)
    const scale = 1 + Math.sin(time * 0.5) * 0.02;
    points.scale.set(scale, scale, scale);
    wireframe.scale.set(scale, scale, scale);

    // 中心脉冲跳动（频率降低）
    pulse.scale.x = 1 + Math.sin(time * 2) * 0.08;
    pulse.scale.y = 1 + Math.cos(time * 2) * 0.08;
    pulse.rotation.z += 0.005;
  }

  function updateCoreWave() {
    // 参考实现无音频波形，保留空实现以兼容 scene.js
  }

  return { group, points, wireframe, pulse, drift, updateCoreWave };
}
