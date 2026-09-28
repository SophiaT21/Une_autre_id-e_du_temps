import * as THREE from "three";

// Environnement statique (ciel + soleil) capturé une seule fois via une
// CubeCamera : sert de source de réflexion à l'eau. Rien ne bouge dans le
// ciel donc pas besoin de le re-capturer à chaque frame.
export function createEnvMap(renderer, resolution = 256) {
  const skyScene = new THREE.Scene();

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;

      void main() {
        vec3 dir = normalize(vDir);
        // Ciel teinté dans la même gamme que l'eau, pour que la réflexion
        // n'y injecte pas du blanc/gris qui ne colle pas à la palette.
        vec3 horizon = vec3(0.35, 0.55, 0.58);
        vec3 zenith = vec3(0.68, 0.85, 0.82);
        vec3 col = mix(horizon, zenith, smoothstep(-0.2, 0.6, dir.z));

        vec3 sunDir = normalize(vec3(0.3, 0.45, 0.7));
        float sun = pow(max(dot(dir, sunDir), 0.0), 900.0);
        col += vec3(1.0) * sun * 2.0;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 32), skyMaterial);
  skyScene.add(sky);

  const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(resolution);
  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
  cubeCamera.update(renderer, skyScene);

  return cubeRenderTarget.texture;
}
