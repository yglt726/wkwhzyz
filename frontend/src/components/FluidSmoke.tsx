/* @refresh reset */
import { useEffect, useRef } from 'react';
import type * as THREE_NS from 'three';

type ThreeModule = typeof import('three');

const NOISE_URL = new URL('../assets/noise.jpeg', import.meta.url).href;

const VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SMOKE_FRAG = `
  uniform sampler2D map;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    float mask = smoothstep(0.5, 0.05, length(vUv - 0.5));
    float v = texture2D(map, vUv).r * mask;
    gl_FragColor = vec4(v, v, v, v * opacity);
  }
`;

const BG_FRAG = `
  #define PI2 6.28318530718
  uniform float time;
  uniform sampler2D tex;
  varying vec2 vUv;

  void main() {
    vec4 n = texture2D(tex, vUv);
    vec2 uv = vUv + vec2(sin(n.r * PI2), cos(n.r * PI2)) * n.r * 0.2;
    float base = clamp((uv.x + 1.0 - uv.y) * 0.5, 0.0, 1.0);
    float wobbleA = sin(vUv.x * 8.8 + time * 0.31 + sin(vUv.y * 6.9 - time * 0.23));
    float wobbleB = cos(vUv.y * 10.1 - time * 0.27 + sin(vUv.x * 7.5 + time * 0.19));
    float d = clamp(base + (wobbleA + wobbleB) * 0.11, 0.0, 1.0);
    float wave = 0.5 + 0.5 * sin((d - time * 0.12) * PI2);
    wave = pow(wave, 2.2);
    vec3 blueCol = mix(vec3(0.01, 0.04, 0.12), vec3(0.06, 0.18, 0.42), d);
    vec3 col = mix(blueCol, vec3(0.55, 0.58, 0.64), wave);
    col += vec3(0.02, 0.05, 0.11) * n.r * (1.0 - wave);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function mount(THREE: ThreeModule, host: HTMLDivElement): () => void {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: false,
    antialias: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;

  const smokeScene = new THREE.Scene();
  const bgScene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);

  let width = 1;
  let height = 1;

  const fbo = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  const noiseTex = new THREE.TextureLoader().load(NOISE_URL);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;

  const TOTAL = 90;
  const geometry = new THREE.PlaneGeometry(40, 42);
  const puffs: THREE_NS.Mesh<THREE_NS.PlaneGeometry, THREE_NS.ShaderMaterial>[] = [];
  for (let i = 0; i < TOTAL; i += 1) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: noiseTex },
          opacity: { value: 0.65 },
        },
        vertexShader: VERT,
        fragmentShader: SMOKE_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    puffs.push(mesh);
    smokeScene.add(mesh);
  }

  const bgMat = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      tex: { value: null },
    },
    vertexShader: VERT,
    fragmentShader: BG_FRAG,
    depthTest: false,
    depthWrite: false,
  });

  const bgGeometry = new THREE.PlaneGeometry(1, 1, 30, 30);
  const bgMesh = new THREE.Mesh(bgGeometry, bgMat);
  bgScene.add(bgMesh);

  let cursor = 0;
  const spawn = (x: number, y: number) => {
    const puff = puffs[cursor];
    cursor = (cursor + 1) % TOTAL;
    puff.visible = true;
    puff.position.set(x - 0.9, y, 0);
    puff.rotation.z = Math.random() * Math.PI * 2;
    puff.scale.set(3.1, 3.1, 1);
    puff.material.uniforms.opacity.value = 0.65;
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    renderer.setSize(width, height, false);
    fbo.setSize(width, height);
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    bgMesh.scale.set(width, height, 1);
  };

  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  let prevX = Number.NaN;
  let prevY = Number.NaN;

  const onPointerMove = (event: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    ) {
      prevX = Number.NaN;
      prevY = Number.NaN;
      return;
    }
    const x = event.clientX - rect.left - width / 2;
    const y = height / 2 - (event.clientY - rect.top);
    if (!Number.isNaN(prevX) && (Math.abs(x - prevX) >= 1 || Math.abs(y - prevY) >= 1)) {
      spawn(x, y);
    }
    prevX = x;
    prevY = y;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  let frame = 0;
  let time = 0;
  const tick = () => {
    frame = requestAnimationFrame(tick);
    time += 0.016;

    for (const puff of puffs) {
      if (!puff.visible) continue;
      puff.rotation.z += 0.02;
      puff.material.uniforms.opacity.value *= 0.96;
      if (puff.material.uniforms.opacity.value < 0.002) {
        puff.visible = false;
        continue;
      }
      puff.scale.x = 0.97 * puff.scale.x + 0.32;
      puff.scale.y = puff.scale.x;
    }

    renderer.setRenderTarget(fbo);
    renderer.clear();
    renderer.render(smokeScene, camera);

    bgMat.uniforms.tex.value = fbo.texture;
    bgMat.uniforms.time.value = time;

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(bgScene, camera);
  };
  tick();

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('pointermove', onPointerMove);
    geometry.dispose();
    bgGeometry.dispose();
    bgMat.dispose();
    noiseTex.dispose();
    fbo.dispose();
    for (const puff of puffs) puff.material.dispose();
    renderer.dispose();
    canvas.remove();
  };
}

export default function FluidSmoke({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let cleanup: (() => void) | undefined;
    let cancelled = false;

    import('three')
      .then((THREE) => {
        if (cancelled) return;
        try {
          cleanup = mount(THREE, host);
        } catch {
          // WebGL 不可用时保持原有渐变背景
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
