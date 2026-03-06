import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createPlexus } from './plexus.js';

/**
 * Three.js scene: 透明背景 + 发光球体 (参考 ai_studio_code)
 * UnrealBloomPass: threshold 0.2, strength 1.2, radius 0.5
 */
export function createScene(container, audio = null) {
  const width = container.clientWidth;
  const height = container.clientHeight;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
  camera.position.z = 3;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const { group: aiCore, drift, updateCoreWave } = createPlexus();
  scene.add(aiCore);

  const hitPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.6),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  hitPlane.position.set(0, 0, 0);
  scene.add(hitPlane);

  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.5,
    0.4,
    0.85
  );
  bloomPass.threshold = 0.2;
  bloomPass.strength = 1.2;
  bloomPass.radius = 0.5;
  composer.addPass(bloomPass);

  let lastTime = performance.now();
  function animate() {
    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    const timeSec = now / 1000;
    lastTime = now;

    updateCoreWave(audio?.getFrequencyData?.());
    drift(delta, timeSec);

    composer.render();
    requestAnimationFrame(animate);
  }
  animate();

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    bloomPass.resolution.set(w, h);
  }
  window.addEventListener('resize', onResize);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onContainerClick(event, onCenterHit) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObject(hitPlane);
    if (hits.length > 0 && onCenterHit) onCenterHit();
  }

  return {
    scene,
    camera,
    renderer,
    composer,
    plexus: { drift },
    onContainerClick,
    containerRef: container,
  };
}
