/* src/core/renderer.js */
import * as THREE from 'three';

export function createRenderer(container, opts = {}) {
  const maxPixelRatio = opts.maxPixelRatio || 1.75;
  let scale = 1;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const updateSize = () => {
    const width = container?.clientWidth || window.innerWidth;
    const height = container?.clientHeight || window.innerHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio) * scale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  };

  if (container) {
    container.appendChild(renderer.domElement);
    new ResizeObserver(updateSize).observe(container);
  }
  window.addEventListener('resize', updateSize);
  updateSize();

  const canvas = renderer.domElement;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    opts.onLost?.();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    updateSize();
    opts.onRestored?.();
  });

  return {
    renderer,
    get scale() {
      return scale;
    },
    setScale(newScale) {
      scale = newScale;
      updateSize();
    }
  };
}

export function createDebugOverlay(renderer) {
  const el = document.createElement('pre');
  el.style.cssText =
  'position:fixed;bottom:8px;left:8px;z-index:999;margin:0;padding:6px 8px;' +
  'background:rgba(0,0,0,0.65);color:#0f0;font:11px/1.4 monospace;pointer-events:none;';
  document.body.appendChild(el);

  return (dtMs, extra = '') => {
    const fps = dtMs > 0 ? (1000 / dtMs).toFixed(0) : '0';
    const info = renderer.info.render;
    el.textContent = `${fps} fps  calls ${info.calls}  tris ${info.triangles}\n${extra}`;
  };
}
