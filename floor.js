import * as THREE from "three";

// Le fond sableux est rendu dans sa propre scène (voir main.js), à part de
// l'eau : c'est cette texture que l'eau échantillonne en réfraction, avec un
// décalage basé sur sa normale locale.
//
// Un dégradé lisse et continu (pas de bruit à cellules) : aucune structure
// répétée possible, juste une variation douce du centre vers les bords.
export function createFloor(width, height) {
  const geometry = new THREE.PlaneGeometry(width, height, 2, 2);

  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;

      void main() {
        float d = length(vWorldPos.xy) / 70.0;
        vec3 center = vec3(0.62, 0.58, 0.42);
        vec3 edge = vec3(0.52, 0.49, 0.35);
        vec3 sandColor = mix(center, edge, smoothstep(0.0, 1.0, d));
        gl_FragColor = vec4(sandColor, 1.0);
      }
    `,
  });

  return new THREE.Mesh(geometry, material);
}
