import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

// Écrans « ciel » (ciel.html) et « arbres » (arbres.html) : un ciel
// d'automne couvert, plein écran, dessiné en shader.
//
// L'écran « ciel » est placé au-dessus de l'écran « arbres » : le bas de
// « ciel » se prolonge dans le haut de « arbres » — les nuages sont
// continus.
//
// L'arbre 3D (assets/arbre/arbre.glb) est placé de chaque côté, pied en bas
// de l'écran « arbres ». Les deux écrans montrent la même scène 3D avec la
// même caméra, chacun sa portion d'une image virtuelle de deux écrans de
// haut (voir updateView) : le haut des arbres, coupé sur « arbres », se
// poursuit en bas de « ciel ».

// Écran affiché, choisi par <body data-screen="..."> dans le HTML.
const SCREEN = document.body.dataset.screen === "arbres" ? "arbres" : "ciel";

const container = document.getElementById("app");
const pixelRatio = Math.min(window.devicePixelRatio, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
// Même rendu final que la flaque (voir main.js).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Champ vertical d'un écran. La caméra voit en réalité une image virtuelle
// de trois écrans de haut (voir updateView), dont chaque écran n'affiche
// qu'un tiers.
const SCREEN_FOV = 40;
const camera = new THREE.PerspectiveCamera(SCREEN_FOV, window.innerWidth / window.innerHeight, 0.1, 200);

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  // 0 = écran « ciel », 1 = écran « arbres » (juste en dessous).
  uScreen: { value: SCREEN === "arbres" ? 1 : 0 },
  // Ciel couvert : gris légèrement vert, cohérent avec l'eau.
  uSkyLight: { value: new THREE.Color(0xc4cbc6) },
  uSkyMid: { value: new THREE.Color(0x8e9a97) },
  uSkyDark: { value: new THREE.Color(0x4f5d5d) },
  // Orage (0 = calme, 1 = ciel noir) : monte quand on lance beaucoup de
  // gouttes en peu de temps, voir stormLevel().
  uStorm: { value: 0 },
  uStormLight: { value: new THREE.Color(0x6d7674) },
  uStormMid: { value: new THREE.Color(0x434b4d) },
  uStormDark: { value: new THREE.Color(0x22282a) },
  // Éclairs (tempête) : illumination des nuages (0-1) autour de uFlashPos,
  // et trait de l'éclair : x du haut, y du bas, graine, intensité.
  uFlash: { value: 0 },
  uFlashPos: { value: new THREE.Vector2(0.5, 0.8) },
  uBolt: { value: new THREE.Vector4(0, 0, 0, 0) },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `
    void main() {
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uScreen;
    uniform vec3 uSkyLight;
    uniform vec3 uSkyMid;
    uniform vec3 uSkyDark;
    uniform float uStorm;
    uniform vec3 uStormLight;
    uniform vec3 uStormMid;
    uniform vec3 uStormDark;
    uniform float uFlash;
    uniform vec2 uFlashPos;
    uniform vec4 uBolt;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * valueNoise(p);
        p = p * 2.03 + 17.1;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 screenUV = gl_FragCoord.xy / uResolution;
      // En unités de hauteur d'écran (x ∈ [0, aspect], y ∈ [0, 1]).
      float aspect = uResolution.x / uResolution.y;
      // L'écran « arbres » est juste en dessous : décalé d'une hauteur.
      vec2 q = vec2(screenUV.x * aspect, screenUV.y - uScreen);

      // Vent : même formule que les reflets d'arbres de water.js.
      float wind = sin(uTime * 0.35) * 0.6 + sin(uTime * 0.83 + 1.3) * 0.3 + sin(uTime * 1.7 + 0.4) * 0.1;

      // Nuages mous, un peu étirés à l'horizontale, qui dérivent et se
      // transforment lentement.
      vec2 cp = vec2(q.x * 0.9, q.y * 1.5) * 1.2 + vec2(uTime * 0.02 + wind * 0.01, uTime * 0.004);
      vec2 warp = vec2(fbm(cp + vec2(0.0, uTime * 0.01)), fbm(cp + vec2(5.2, 1.3) - uTime * 0.008));
      float clouds = fbm(cp + warp * 0.55);
      float detail = fbm(cp * 2.2 - warp * 0.4 + uTime * 0.015);
      clouds = clouds * 0.8 + detail * 0.2;
      // Orage : la couverture nuageuse s'épaissit (moins de trouées claires).
      clouds -= uStorm * 0.18;

      // Palette qui glisse vers des gris-noirs d'orage.
      vec3 cDark = mix(uSkyDark, uStormDark, uStorm);
      vec3 cMid = mix(uSkyMid, uStormMid, uStorm);
      vec3 cLight = mix(uSkyLight, uStormLight, uStorm);
      vec3 sky = mix(cDark, cMid, smoothstep(0.3, 0.55, clouds));
      sky = mix(sky, cLight, smoothstep(0.5, 0.75, clouds));
      // Un peu plus clair vers le bas (vers l'horizon).
      sky = mix(sky, cLight, (1.0 - smoothstep(0.0, 0.6, q.y)) * 0.3);
      // Soleil voilé derrière les nuages.
      vec2 sunPos = vec2(aspect * 0.6, 0.65);
      float glow = exp(-dot(q - sunPos, q - sunPos) * 5.0);
      // Le soleil voilé s'éteint sous l'orage.
      sky += vec3(0.1, 0.09, 0.07) * glow * (1.0 - uStorm);

      // --- Éclair : les nuages s'illuminent de l'intérieur autour du point
      // de l'éclair, surtout leurs parties épaisses et claires. ---
      if (uFlash > 0.0) {
        vec2 fd = q - uFlashPos;
        float flashGlow = exp(-dot(fd, fd) * 1.3);
        float cloudLit = 0.55 + 0.9 * smoothstep(0.3, 0.75, clouds);
        sky += vec3(0.72, 0.78, 0.9) * uFlash * (0.2 + 0.8 * flashGlow) * cloudLit;
      }
      // Trait de l'éclair : ligne brisée qui descend du haut de l'écran
      // jusqu'à uBolt.y, avec une ramification.
      if (uBolt.w > 0.0) {
        float seed = uBolt.z;
        float by = q.y;
        float bx = uBolt.x
          + (fbm(vec2(by * 2.5, seed)) - 0.5) * 0.35
          + (valueNoise(vec2(by * 24.0, seed + 5.0)) - 0.5) * 0.05;
        float along = smoothstep(uBolt.y, uBolt.y + 0.04, by);
        float dist = abs(q.x - bx);
        float bolt = (1.0 - smoothstep(0.0012, 0.0035, dist)) * along;
        float halo = exp(-dist * 55.0) * along;
        // Ramification : part d'un point du trait et s'en écarte en descendant.
        float yb = mix(1.0, uBolt.y, 0.35);
        float side = hash(vec2(seed, 3.0)) < 0.5 ? -1.0 : 1.0;
        float drop = yb - by;
        if (drop > 0.0 && drop < 0.3) {
          float bx2 = bx + side * drop * 0.55 + (valueNoise(vec2(by * 30.0, seed + 9.0)) - 0.5) * 0.04;
          float d2 = abs(q.x - bx2);
          float fade = 1.0 - drop / 0.3;
          bolt = max(bolt, (1.0 - smoothstep(0.0008, 0.0025, d2)) * fade * 0.8);
          halo = max(halo, exp(-d2 * 70.0) * fade * 0.6);
        }
        sky += vec3(0.92, 0.95, 1.0) * uBolt.w * (bolt * 1.6 + halo * 0.45);
      }

      gl_FragColor = vec4(sky, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
quad.frustumCulled = false;
// Le ciel est dessiné en premier, derrière tout le reste.
quad.renderOrder = -1;
scene.add(quad);

// --- Arbres 3D (écran « arbres ») ------------------------------------------

// Vent : même formule que le ciel et les reflets d'arbres de water.js.
function windAt(t) {
  return Math.sin(t * 0.35) * 0.6 + Math.sin(t * 0.83 + 1.3) * 0.3 + Math.sin(t * 1.7 + 0.4) * 0.1;
}

const windUniform = { value: 0 };
const timeUniform = { value: 0 };
// Hauteur du modèle, mesurée au chargement (sert au balancement).
const treeHeightUniform = { value: 16 };

// Balancement qui croît avec la hauteur dans l'arbre, et (pour les
// feuilles) un frémissement rapide.
function addWind(material, flutter) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.uniforms.uTime = timeUniform;
    shader.uniforms.uTreeHeight = treeHeightUniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uWind;
        uniform float uTime;
        uniform float uTreeHeight;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float hRel = clamp(position.y / uTreeHeight, 0.0, 1.0);
        float bend = hRel * hRel;
        transformed.x += (uWind * 0.35 + sin(uTime * 0.9 + position.z * 0.2) * 0.06) * bend;
        transformed.z += sin(uTime * 0.7 + position.x * 0.2) * 0.05 * bend;
        ${
          flutter
            ? `float ph = dot(position, vec3(1.7, 2.3, 1.1));
        transformed += vec3(sin(uTime * 3.1 + ph), sin(uTime * 2.3 + ph * 1.3), cos(uTime * 2.7 + ph)) * 0.025 * hRel;`
            : ""
        }`
      );
  };
  // Programmes distincts pour l'écorce et les feuilles.
  material.customProgramCacheKey = () => (flutter ? "wind-leaves" : "wind-bark");
}

const textureLoader = new THREE.TextureLoader();
function loadTexture(path, srgb) {
  const t = textureLoader.load(path);
  // Convention glTF : pas d'inversion verticale des UV.
  t.flipY = false;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Deux arbres, un de chaque côté de l'écran vertical. side : -1 gauche,
// +1 droite. inset : position du tronc depuis le bord (fraction de la
// demi-largeur). rotation : pour ne pas voir deux fois le même arbre.
const TREE_PLACEMENTS = [
  { side: -1, inset: 1.0, rotation: 0.4, scale: 1.0, lift: 0.15 },
  { side: 1, inset: 0.9, rotation: 2.6, scale: 0.92 },
];
const TREE_DISTANCE = 30;
// Hauteur des arbres par rapport à l'écran (1 = pile la hauteur de l'écran).
const TREE_HEIGHT = 1.25;
const trees = [];
const treeSize = new THREE.Vector3(16, 16, 16);

// Lumières de la scène (atténuées par l'orage, voir animate).
let hemiLight = null;
let sunLight = null;

function placeTrees() {
  // Demi-hauteur et demi-largeur d'un écran, à la distance des arbres.
  const halfH = Math.tan(THREE.MathUtils.degToRad(SCREEN_FOV / 2)) * TREE_DISTANCE;
  const halfW = halfH * (window.innerWidth / window.innerHeight);
  for (const tree of trees) {
    const p = tree.userData.placement;
    // Hauteur de l'arbre en fraction de la hauteur de l'écran : au-delà de
    // 1, le feuillage dépasse par le haut (le pied reste sous le bas).
    const s = ((halfH * 2 * TREE_HEIGHT) / treeSize.y) * p.scale;
    tree.scale.setScalar(s);
    // lift : remonte l'arbre, en fraction de la hauteur d'un écran.
    const lift = (p.lift || 0) * halfH * 2;
    tree.position.set(p.side * halfW * p.inset, -halfH - 0.5 + lift, -TREE_DISTANCE);
  }
}

{
  hemiLight = new THREE.HemisphereLight(0xc4cbc6, 0x6b5a48, 1.6);
  scene.add(hemiLight);
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.1);
  sunLight = sun;
  sun.position.set(6, 10, 4);
  scene.add(sun);

  const barkMaterial = new THREE.MeshStandardMaterial({
    map: loadTexture("assets/arbre/ecorce.jpg", true),
    roughness: 0.95,
    color: 0x9a8c80,
  });
  addWind(barkMaterial, false);

  // Texture de feuilles en niveaux de gris, teintée par la couleur
  // d'automne cuite pour chaque feuille à l'export (voir
  // assets/arbre/export_arbre.py).
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: loadTexture("assets/arbre/feuilles_gris.jpg", true),
    alphaMap: loadTexture("assets/arbre/feuilles_opacite.jpg", false),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    vertexColors: true,
    roughness: 0.75,
  });
  addWind(leafMaterial, true);

  const dracoLoader = new DRACOLoader();
  // Décodeur fourni dans le projet (fonctionne hors ligne).
  dracoLoader.setDecoderPath("vendor/three/examples/jsm/libs/draco/gltf/");
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.load("assets/arbre/arbre.glb", (gltf) => {
    const source = gltf.scene;
    new THREE.Box3().setFromObject(source).getSize(treeSize);
    treeHeightUniform.value = treeSize.y;
    source.traverse((child) => {
      if (!child.isMesh) return;
      // On remplace les matériaux selon le nom exporté.
      child.material = child.material.name.includes("Leaves") ? leafMaterial : barkMaterial;
    });
    for (const placement of TREE_PLACEMENTS) {
      const tree = source.clone();
      tree.userData.placement = placement;
      tree.rotation.y = placement.rotation;
      scene.add(tree);
      trees.push(tree);
    }
    placeTrees();
  });
}

// --- Goutte : un clic sur « ciel » la fait tomber, elle continue sur « arbres »

// Distance de la goutte à la caméra (devant les arbres).
const DROP_DISTANCE = 10;
// Hauteur de la goutte en fraction de la hauteur de l'écran.
const DROP_SIZE = 0.025;
// Chaque goutte a une taille tirée au hasard entre ces deux facteurs de
// DROP_SIZE (plus petite… ou plus grosse).
const DROP_SIZE_MIN = 0.7;
const DROP_SIZE_MAX = 1.3;
// Temps de traversée de l'écran (s), départ arrêté, en accélérant.
const DROP_FALL_TIME = 1.4;
// En tempête, les gouttes deviennent des traits : jusqu'à (1 + STREAK_LENGTH)
// fois plus longues, (1 + STREAK_THINNING) fois plus fines, et elles tombent
// jusqu'à STREAK_SPEEDUP (fraction) plus vite.
const STREAK_LENGTH = 5;
const STREAK_THINNING = 4;
const STREAK_SPEEDUP = 0.45;

// --- Installation : la goutte tombe du ciel jusque dans les flaques ---------
// Écran ciel (paysage, 1920×1080) suspendu au-dessus des deux écrans flaques
// (portrait, 1080×1920 chacun, côte à côte). Même taille de pixel partout :
// le ciel (1920 px de large) couvre le centre des deux flaques (2 × 1080 =
// 2160 px), avec 120 px de flaque qui dépassent de chaque côté.
const INSTALLATION = {
  skyWidthPx: 1920,
  puddleWidthPx: 1080,
  puddleCount: 2,
  // Hauteur de chute entre l'écran ciel et les flaques (m).
  fallHeightM: 1.3,
  // Hauteur physique de l'écran ciel (m) — ~0,30 m pour un écran 24".
  // Sert à convertir la vitesse de la goutte à l'écran en vitesse réelle.
  skyScreenHeightM: 0.3,
  // true si la gauche du ciel correspond à la droite des flaques.
  mirrorX: false,
};
const GRAVITY = 9.81;

// Temps (s) et vitesse (unités monde/s) de la goutte quand elle a parcouru
// la distance D depuis son départ (chute accélérée puis vitesse limite).
function fallAfter(p, D) {
  const tMax = p.maxSpeed / p.gravity;
  const dMax = 0.5 * p.gravity * tMax * tMax;
  if (D <= dMax) {
    const t = Math.sqrt((2 * D) / p.gravity);
    return { t, v: p.gravity * t };
  }
  return { t: tMax + (D - dMax) / p.maxSpeed, v: p.maxSpeed };
}

// Délai entre le clic et l'impact dans la flaque : la goutte traverse
// l'écran ciel, puis tombe réellement de fallHeightM, en partant à la
// vitesse qu'elle avait en sortant de l'écran.
function impactDelay(params, bounds) {
  const exit = fallAfter(params, params.y0 - bounds.bottom);
  const v0 = (exit.v / params.screenHeight) * INSTALLATION.skyScreenHeightM;
  const h = INSTALLATION.fallHeightM;
  const tAir = (-v0 + Math.sqrt(v0 * v0 + 2 * GRAVITY * h)) / GRAVITY;
  return exit.t + tAir;
}

// Annonce aux flaques où et quand la goutte va tomber. u : position
// horizontale dans le ciel (0 = gauche, 1 = droite).
function sendDropToPuddles(u, delay, storm = 0) {
  const { skyWidthPx, puddleWidthPx, puddleCount, mirrorX } = INSTALLATION;
  const totalPx = puddleWidthPx * puddleCount;
  // Position sous la goutte, en fraction de la largeur totale des flaques
  // (0 = bord gauche de la flaque 1, 1 = bord droit de la dernière).
  let x = ((totalPx - skyWidthPx) / 2 + u * skyWidthPx) / totalPx;
  if (mirrorX) x = 1 - x;
  // y : position en hauteur, tirée au hasard (la même pour toutes les
  // flaques). delay : secondes avant l'impact.
  // storm : force de la tempête quand la goutte est partie (ondes plus
  // fines sur les flaques).
  const message = { type: "goutte", x, y: Math.random(), delay, storm };
  // Par le serveur (serveur.py) et par le navigateur : chaque flaque
  // n'écoute que l'un des deux, donc pas de doublon.
  fetch("/onde", { method: "POST", body: JSON.stringify(message) }).catch(() => {});
  puddleChannel.postMessage(message);
}
const puddleChannel = new BroadcastChannel("eau-interferences");

// Envoie aux flaques l'assombrissement du ciel (uStorm), quelques fois par
// seconde quand il change, et de temps en temps sinon (flaque ouverte après
// le ciel).
let sentStorm = -1;
let lastStormSent = 0;
function sendStormToPuddles(storm, now) {
  const changed = Math.abs(storm - sentStorm) > 0.005;
  if (now - lastStormSent < (changed ? 0.2 : 2)) return;
  sentStorm = storm;
  lastStormSent = now;
  const message = { type: "ciel", storm };
  fetch("/onde", { method: "POST", body: JSON.stringify(message) }).catch(() => {});
  puddleChannel.postMessage(message);
}

// Annonce un éclair aux flaques, avec sa force (même valeur que le flash
// du ciel) : elles rejouent la même courbe de lumière (lightningEnvelope).
function sendLightningToPuddles() {
  const message = { type: "eclair", flash: LIGHTNING.flash };
  fetch("/onde", { method: "POST", body: JSON.stringify(message) }).catch(() => {});
  puddleChannel.postMessage(message);
}


let dropSource = null;
// Matériaux de la goutte (partagés par toutes les copies), pour ajuster
// leurs reflets selon l'orage.
const dropMaterials = [];
const DROP_ENV_INTENSITY = 1.2;
// Teinte du corps de la goutte, par temps calme et sous l'orage.
const DROP_COLOR = new THREE.Color(0xdde6e8);
const DROP_STORM_COLOR = new THREE.Color(0x848e8e);
// Opacité des gouttes au plus fort de l'orage (1 = opaques comme d'habitude).
const DROP_STORM_OPACITY = 0.45;
let dropHeight = 1;
const drops = [];

// Reflets d'environnement pour la goutte seulement (les arbres gardent leur
// éclairage) : sans eux, un matériau transparent paraît terne.
const pmrem = new THREE.PMREMGenerator(renderer);
const dropEnvMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Goutte construite en Three.js : un profil tourné autour de l'axe vertical
// (LatheGeometry) — demi-sphère en bas, qui s'effile en pointe vers le haut.
function createDrop() {
  // Courbe classique de la goutte : r = sin t · sin(t/2), y = cos t
  // (t de π à 0) — fond rond, pointe nette en haut. Étirée en hauteur.
  const points = [];
  const steps = 48;
  const stretchY = 1.4;
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI * (1 - i / steps);
    points.push(new THREE.Vector2(Math.sin(t) * Math.sin(t / 2), Math.cos(t) * stretchY));
  }
  const geometry = new THREE.LatheGeometry(points, 48);

  // Eau : transparente, réfracte ce qui est derrière, reflets nets.
  const material = new THREE.MeshPhysicalMaterial({
    // Corps très légèrement visible, pour que toute la silhouette (pointe
    // comprise) se lise sur le ciel.
    color: DROP_COLOR.clone(),
    metalness: 0,
    roughness: 0.04,
    transmission: 0.88,
    ior: 1.33,
    thickness: 1.2,
    // Légère teinte dans l'épaisseur : la goutte paraît pleine d'eau.
    attenuationColor: new THREE.Color(0xb9cfd2),
    attenuationDistance: 1.8,
    specularIntensity: 1,
    envMap: dropEnvMap,
    envMapIntensity: DROP_ENV_INTENSITY,
    // Pour pouvoir estomper les gouttes sous l'orage (voir animate).
    transparent: true,
    depthWrite: false,
  });
  dropMaterials.push(material);

  dropSource = new THREE.Mesh(geometry, material);
  dropHeight = 2 * stretchY;
}
createDrop();

// Hauteur (en Y monde) du bas et du haut de l'écran courant, et sa
// demi-largeur, à la distance d de la caméra. Voir updateView : « arbres »
// est au milieu de l'image virtuelle, « ciel » juste au-dessus.
function screenBoundsAt(d) {
  const t = Math.tan(THREE.MathUtils.degToRad(SCREEN_FOV / 2));
  const bottom = SCREEN === "arbres" ? -t : t;
  return {
    bottom: bottom * d,
    top: (bottom + 2 * t) * d,
    halfWidth: t * (window.innerWidth / window.innerHeight) * d,
  };
}

const raycaster = new THREE.Raycaster();
const dropPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), DROP_DISTANCE);
const pointer = new THREE.Vector2();
const hit = new THREE.Vector3();

// Les deux écrans (même navigateur, même machine) se partagent les gouttes :
// « ciel » annonce chaque goutte lancée, « arbres » la reçoit. La chute est
// calculée à partir de l'horloge de l'ordinateur et les deux écrans
// partagent la même scène 3D : la goutte sort du bas de « ciel » et entre
// par le haut de « arbres » exactement au même moment.
const channel = new BroadcastChannel("une-autre-idee-du-temps");

let umbrellaState = 0;
let umbrellaIntensity = 0;
const UMBRELLA_TRANSITION_TIME = 3;

const umbrellaEvents = new EventSource("/evenements");

umbrellaEvents.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "umbrella") {
      const wasOpen = umbrellaState > 0;
      umbrellaState = data.state;
      console.log("☂️ ÉTAT PARAPLUIE →", umbrellaState);
      if (SCREEN === "ciel") {
        if (umbrellaState > 0 && !wasOpen) playStormSound();
      }
    }
  } catch {
    // Ignore les messages qui ne sont pas du JSON valide.
  }
};

// --- Son de la tempête : joué quand le parapluie s'ouvre -------------------

// Rejoué depuis le début à chaque ouverture du parapluie, en boucle. Son
// volume suit la force de la tempête (umbrellaIntensity, voir
// updateStormSound) : il monte avec elle, baisse quand le ciel s'éclaircit et
// s'arrête quand la tempête est finie.
const STORM_SOUND_FILE = "rain-on-an-umbrella.mp3";
const STORM_SOUND_VOLUME = 1;
const stormSound = new Audio(STORM_SOUND_FILE);
stormSound.preload = "auto";
stormSound.loop = true;

function playStormSound() {
  stormSound.currentTime = 0;
  // Chrome bloque le son tant qu'on n'a pas cliqué sur la page (sauf lancé
  // avec ciel_son.bat / lancer-ciel.command) : dans ce cas, il démarre au
  // premier clic, si le parapluie est toujours ouvert.
  stormSound.play().catch(() => {
    window.addEventListener(
      "pointerdown",
      () => {
        if (umbrellaState > 0) stormSound.play().catch(() => {});
      },
      { once: true }
    );
  });
}

// À chaque image : volume = force de la tempête ; arrêt quand elle est finie.
function updateStormSound() {
  if (stormSound.paused) return;
  stormSound.volume = THREE.MathUtils.clamp(umbrellaIntensity, 0, 1) * STORM_SOUND_VOLUME;
  if (umbrellaState <= 0 && umbrellaIntensity < 0.01) stormSound.pause();
}

function nowSeconds() {
  return Date.now() / 1000;
}

// Force de la tempête du parapluie (0-1), progressive : quand le parapluie
// s'ouvre, elle monte en TEMPEST.rampUp s ; quand il se ferme, elle retombe
// en TEMPEST.rampDown s (au lieu de passer d'un coup de 0 à 1).
let umbrellaRamp = 0;
let umbrellaRampTime = nowSeconds();
function umbrellaLevel(now = nowSeconds()) {
  const dt = Math.max(0, now - umbrellaRampTime);
  umbrellaRampTime = now;
  if (umbrellaState > umbrellaRamp) umbrellaRamp = Math.min(umbrellaState, umbrellaRamp + dt / TEMPEST.rampUp);
  else umbrellaRamp = Math.max(umbrellaState, umbrellaRamp - dt / TEMPEST.rampDown);
  return THREE.MathUtils.smoothstep(umbrellaRamp, 0, 1);
}

// Ajoute une goutte à la scène. params : { x, y0, t0, gravity, maxSpeed, scale }.
// --- Orage : beaucoup de gouttes en peu de temps assombrissent le ciel ---

// Chaque goutte ajoute STORM_PER_DROP d'« énergie », qui monte en ~1,5 s
// puis retombe (moitié perdue en ~STORM_HALF_LIFE s). L'orage ne commence
// qu'au-delà de STORM_THRESHOLD : quelques gouttes isolées ne font rien.
const STORM_PER_DROP = 0.1;
const STORM_HALF_LIFE = 8;
const STORM_THRESHOLD = 0.3;
// Intensité maximale de l'assombrissement (1 = couleurs d'orage complètes).
const STORM_MAX = 0.5;
const stormDrops = [];

function stormLevel(t) {
  let energy = 0;
  const decay = Math.LN2 / STORM_HALF_LIFE;
  for (let i = stormDrops.length - 1; i >= 0; i--) {
    const dt = t - stormDrops[i];
    if (dt > STORM_HALF_LIFE * 8) {
      stormDrops.splice(i, 1);
      continue;
    }
    if (dt < 0) continue;
    energy += STORM_PER_DROP * (1 - Math.exp(-dt / 1.5)) * Math.exp(-dt * decay);
  }
  return THREE.MathUtils.smoothstep(energy, STORM_THRESHOLD, 1.0);
}

function addDrop(params) {
  // Compte pour l'orage (sur les deux écrans, à partir de la même heure de
  // départ : le ciel s'assombrit pareil des deux côtés).
  // La pluie automatique ne compte pas : seuls les clics font l'orage.
  if (!params.auto) stormDrops.push(params.t0);
  if (!dropSource) return;
  const drop = dropSource.clone();
  drop.scale.setScalar(params.scale);
  drop.position.set(params.x, params.y0, -DROP_DISTANCE);
  drop.userData = params;
  scene.add(drop);
  drops.push(drop);
}

function spawnDrop(event) {
  launchDrop(event.clientX, event.clientY, false);
}

// Lance une goutte à la position écran (clientX, clientY). auto : goutte de
// la pluie automatique (ne compte pas pour l'orage, voir addDrop).
function launchDrop(clientX, clientY, auto) {
  if (!dropSource) return;
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dropPlane, hit)) return;

  const bounds = screenBoundsAt(DROP_DISTANCE);
  const screenHeight = bounds.top - bounds.bottom;
  // Accélération telle que la goutte traverse l'écran « ciel » en
  // DROP_FALL_TIME ; ensuite elle garde cette vitesse (vitesse limite).
  // Tempête : la goutte devient un trait (voir updateDrops) et tombe plus vite.
  const streak = auto && SCREEN === "ciel" ? umbrellaIntensity : 0;
  const fallTime = DROP_FALL_TIME * (1 - STREAK_SPEEDUP * streak);
  const gravity = (2 * screenHeight * (1 + DROP_SIZE * 2)) / (fallTime * fallTime);
  const params = {
    // Même position horizontale que le clic, départ juste au-dessus du haut.
    x: hit.x,
    y0: bounds.top + screenHeight * DROP_SIZE,
    t0: nowSeconds(),
    gravity,
    maxSpeed: gravity * fallTime,
    scale: (screenHeight * DROP_SIZE * THREE.MathUtils.randFloat(DROP_SIZE_MIN, DROP_SIZE_MAX)) / dropHeight,
    screenHeight,
    auto,
    streak,
  };
  addDrop(params);
  channel.postMessage({ type: "drop", params });
  // Un clic fait toujours son onde. La pluie automatique : toutes ses
  // gouttes en pluie légère ; en tempête, juste ce qu'il faut pour que le
  // nombre d'ondes par seconde suive la force de la tempête (jusqu'à
  // TEMPEST.puddleRate au plus fort) — l'eau s'agite en même temps que le
  // ciel s'assombrit, et se calme avec lui.
  if (!auto || Math.random() < puddleChance(streak)) {
    sendDropToPuddles(clientX / window.innerWidth, impactDelay(params, bounds), streak);
  }
}

channel.addEventListener("message", (event) => {
  if (event.data && event.data.type === "drop" && SCREEN === "arbres") {
    addDrop(event.data.params);
  }
});

function updateDrops() {
  const bounds = screenBoundsAt(DROP_DISTANCE);
  const t = nowSeconds();
  for (let i = drops.length - 1; i >= 0; i--) {
    const drop = drops[i];
    const p = drop.userData;
    const elapsed = Math.max(t - p.t0, 0);
    // Chute accélérée jusqu'à la vitesse limite, puis vitesse constante.
    const tMax = p.maxSpeed / p.gravity;
    let fallen;
    let speed;
    if (elapsed < tMax) {
      fallen = 0.5 * p.gravity * elapsed * elapsed;
      speed = p.gravity * elapsed;
    } else {
      fallen = 0.5 * p.gravity * tMax * tMax + p.maxSpeed * (elapsed - tMax);
      speed = p.maxSpeed;
    }
    drop.position.y = p.y0 - fallen;
    // Légèrement étirée par la vitesse.
    const stretch = 1 + Math.min(speed / (p.screenHeight * 2), 0.25);
    // Tempête : très allongée et très fine, elle ne ressemble plus qu'à un
    // trait de pluie.
    const streak = p.streak || 0;
    const long = stretch * (1 + streak * STREAK_LENGTH);
    const thin = Math.sqrt(stretch) * (1 + streak * STREAK_THINNING);
    drop.scale.set(p.scale / thin, p.scale * long, p.scale / thin);
    // Sortie par le bas de cet écran : on la retire.
    if (drop.position.y < bounds.bottom - p.screenHeight * DROP_SIZE * 3) {
      scene.remove(drop);
      drops.splice(i, 1);
    }
  }
}

// --- Tempêtes : de temps en temps, le ciel s'assombrit et il pleut fort ---

const TEMPEST = {
  // Première tempête : ce nombre de secondes après le lancement de la page.
  firstDelay: 10,
  // Temps calme entre deux tempêtes suivantes, tiré au hasard (s).
  minCalm: 60,
  maxCalm: 150,
  // Durée d'une tempête, hors montée et descente (s).
  minDuration: 30,
  maxDuration: 45,
  // Temps pour que le ciel s'assombrisse / redevienne clair (s).
  rampUp: 6,
  rampDown: 10,
  // Assombrissement du ciel au plus fort (1 = couleurs d'orage complètes).
  darkness: 0.75,
  // Gouttes par seconde au plus fort (en tempête un trait reste ~0,8 s à
  // l'écran : 130/s ≈ une centaine de traits visibles en même temps).
  heavyRate: 130,
  // Nombre maximum d'ondes par seconde envoyées aux flaques par la pluie
  // automatique : pendant la tempête, seule une partie des gouttes fait une
  // onde (fine et courte, voir water.js) — assez pour une eau très agitée,
  // pas trop pour garder l'affichage fluide.
  puddleRate: 12,
};
let tempestStart = Infinity;
let tempestEnd = Infinity;

function scheduleTempest(from, calm = THREE.MathUtils.randFloat(TEMPEST.minCalm, TEMPEST.maxCalm)) {
  tempestStart = from + calm;
  tempestEnd = tempestStart + THREE.MathUtils.randFloat(TEMPEST.minDuration, TEMPEST.maxDuration);
}

function startTempestNow() {
  const now = nowSeconds();
  // Si une tempête est déjà en cours, on la prolonge simplement.
  if (tempestLevel(now) <= 0) tempestStart = now;
  tempestEnd = now + THREE.MathUtils.randFloat(TEMPEST.minDuration, TEMPEST.maxDuration);
}

// --- Éclairs : pendant la tempête, de temps en temps ----------------------

const LIGHTNING = {
  // La tempête doit être au moins à ce niveau pour qu'il y ait des éclairs.
  minTempest: 0.5,
  // Intervalle entre deux éclairs, tiré au hasard (s).
  minInterval: 8,
  maxInterval: 16,
  // Force de l'illumination des nuages (0-1).
  flash: 0.9,
};
let lightningStart = -Infinity;
let nextLightning = 0;

// Son de la foudre : part THUNDER_LEAD s avant chaque éclair, tiré au
// hasard parmi THUNDER_SOUND_FILES (jamais deux fois le même de suite). Une
// copie du son par éclair, pour que deux coups de tonnerre proches se
// superposent.
const THUNDER_SOUND_FILES = ["foudre.mp3", "foudre2.mp3", "foudre3.mp3"];
const THUNDER_SOUND_VOLUME = 1;
const THUNDER_LEAD = 4;
const thunderSounds = THUNDER_SOUND_FILES.map((file) => {
  const sound = new Audio(file);
  sound.preload = "auto";
  return sound;
});
let lastThunder = -1;
// Éclair (heure prévue) dont le tonnerre a déjà été lancé.
let thunderPlayedFor = -1;

function playThunderSound() {
  let i = Math.floor(Math.random() * thunderSounds.length);
  if (i === lastThunder && thunderSounds.length > 1) i = (i + 1) % thunderSounds.length;
  lastThunder = i;
  const sound = thunderSounds[i].cloneNode();
  sound.volume = THUNDER_SOUND_VOLUME;
  sound.play().catch(() => {});
}

// Intensité de l'éclair dt secondes après son début : deux ou trois
// scintillements rapides puis une lueur qui s'éteint.
function lightningEnvelope(dt) {
  if (dt < 0 || dt > 1.2) return 0;
  const pulse = (c, w) => Math.exp(-(((dt - c) / w) ** 2));
  return Math.min(1, pulse(0.03, 0.045) + 0.65 * pulse(0.17, 0.05) + 0.45 * pulse(0.34, 0.08) + 0.2 * Math.exp(-dt * 4));
}

function updateLightning(now) {
  const level = tempestLevel(now);
  if (level < LIGHTNING.minTempest) {
    // Premier éclair peu après que la tempête est bien installée, assez
    // tard pour que son tonnerre parte THUNDER_LEAD s avant.
    nextLightning = now + THUNDER_LEAD + THREE.MathUtils.randFloat(0.5, 2);
  } else if (now >= nextLightning) {
    lightningStart = now;
    nextLightning = now + THREE.MathUtils.randFloat(LIGHTNING.minInterval, LIGHTNING.maxInterval);
    // Position (en unités de hauteur d'écran, x de 0 à largeur/hauteur).
    const aspect = window.innerWidth / window.innerHeight;
    const x = THREE.MathUtils.randFloat(0.12, 0.88) * aspect;
    uniforms.uBolt.value.set(x, THREE.MathUtils.randFloat(-0.1, 0.35), Math.random() * 100, 0);
    uniforms.uFlashPos.value.set(x, THREE.MathUtils.randFloat(0.55, 0.95));
    // La flaque reflète la lumière de l'éclair, au même moment et au même
    // rythme (voir main.js).
    sendLightningToPuddles();
  }
  // Tonnerre THUNDER_LEAD s avant l'éclair prévu (une fois par éclair).
  if (level >= LIGHTNING.minTempest && now >= nextLightning - THUNDER_LEAD && thunderPlayedFor !== nextLightning) {
    thunderPlayedFor = nextLightning;
    playThunderSound();
  }
  const e = lightningEnvelope(now - lightningStart);
  uniforms.uFlash.value = e * LIGHTNING.flash;
  // Le trait n'est visible que pendant les premiers scintillements.
  uniforms.uBolt.value.w = now - lightningStart < 0.45 ? e : 0;
  return e;
}

// Force de la tempête (0 = calme, 1 = au plus fort). Programme la suivante
// une fois celle-ci terminée.
function tempestLevel(t) {
  if (t > tempestEnd + TEMPEST.rampDown) scheduleTempest(t);
  const up = THREE.MathUtils.smoothstep(t, tempestStart, tempestStart + TEMPEST.rampUp);
  const down = 1 - THREE.MathUtils.smoothstep(t, tempestEnd, tempestEnd + TEMPEST.rampDown);
  return Math.min(up, down);
}


// --- Pluie automatique : gouttes aléatoires et espacées, sans clic ---------

// Pluie légère : en moyenne une goutte toutes les LIGHT_RAIN_INTERVAL s,
// à des moments aléatoires.
const LIGHT_RAIN_INTERVAL = 4.5;
const RAIN_TICK = 0.05;

function startAutoRain() {
  setInterval(() => {
    // Gouttes par seconde : pluie légère → très forte pendant une tempête.
    const rate = THREE.MathUtils.lerp(
      1 / LIGHT_RAIN_INTERVAL,
      TEMPEST.heavyRate,
      umbrellaIntensity
    );
    // Nombre de gouttes pour ce pas de temps, au hasard autour de la moyenne.
    const expected = rate * RAIN_TICK;
    const count = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      launchDrop(Math.random() * window.innerWidth, Math.random() * window.innerHeight, true);
    }
  }, RAIN_TICK * 1000);
}

// Probabilité qu'une goutte automatique fasse une onde sur les flaques,
// selon la force de la tempête L au moment où elle part : ondes par seconde
// voulues ÷ gouttes par seconde.
function puddleChance(L) {
  // Hors tempête : une onde pour chaque goutte.
  if (L <= 0) return 1;
  const lightRate = 1 / LIGHT_RAIN_INTERVAL;
  const dropsPerSecond = THREE.MathUtils.lerp(lightRate, TEMPEST.heavyRate, L);
  const ripplesPerSecond = THREE.MathUtils.lerp(lightRate, TEMPEST.puddleRate, L);
  return Math.min(1, ripplesPerSecond / dropsPerSecond);
}

if (SCREEN === "ciel") {
  scheduleTempest(nowSeconds(), TEMPEST.firstDelay);
  // Touche T : déclenche une tempête tout de suite (pour tester).
  window.addEventListener("keydown", (event) => {
    if (event.key === "t" || event.key === "T") startTempestNow();
  });
  // Le clic reste possible pour lancer une goutte à la main.
  renderer.domElement.addEventListener("pointerdown", spawnDrop);
  startAutoRain();
}

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(
    window.innerWidth * pixelRatio,
    window.innerHeight * pixelRatio,
    // MSAA : bords des feuilles moins crénelés.
    { type: THREE.HalfFloatType, samples: 4 }
  )
);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());

// Cadrage : image virtuelle de trois hauteurs d'écran, centrée sur l'écran
// « arbres » (tiers du milieu). L'écran « ciel » affiche le tiers du haut,
// juste au-dessus, pour que les arbres se raccordent entre les deux.
function updateView() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const t = Math.tan(THREE.MathUtils.degToRad(SCREEN_FOV / 2));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(3 * t));
  camera.aspect = w / (h * 3);
  camera.setViewOffset(w, h * 3, 0, SCREEN === "arbres" ? h : 0, w, h);
}

function setResolution() {
  uniforms.uResolution.value.set(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio);
  updateView();
  placeTrees();
}
setResolution();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  setResolution();
});

function animate() {
  requestAnimationFrame(animate);
  updateDrops();
  // Temps tiré de l'horloge de l'ordinateur : les deux écrans ouverts sur
  // la même machine restent synchronisés. Modulo une heure pour garder de
  // la précision.
  const t = (Date.now() / 1000) % 3600;
  uniforms.uTime.value = t;
  timeUniform.value = t;
  windUniform.value = windAt(t);
  // Assombrissement : orage des clics nombreux, ou tempête automatique.
const targetUmbrellaIntensity = umbrellaState;
const transitionSpeed = 1 / UMBRELLA_TRANSITION_TIME;
umbrellaIntensity = THREE.MathUtils.lerp(
  umbrellaIntensity,
  targetUmbrellaIntensity,
  Math.min(1, transitionSpeed / 60)
);
  const storm = Math.max(
  stormLevel(nowSeconds()) * STORM_MAX,
  SCREEN === "ciel" ? umbrellaIntensity * TEMPEST.darkness : 0
);
  uniforms.uStorm.value = storm;
  if (SCREEN === "ciel") updateStormSound();
  if (SCREEN === "ciel") sendStormToPuddles(storm, nowSeconds());
  // Éclairs (écran ciel) : illuminent aussi un instant les arbres.
  const flash = SCREEN === "ciel" ? updateLightning(nowSeconds()) : 0;
  if (hemiLight) hemiLight.intensity = 1.6 * (1 - storm * 0.45) * (1 + flash * 1.6);
  if (sunLight) sunLight.intensity = 1.1 * (1 - storm * 0.8);
  // Les reflets de la goutte s'éteignent avec le ciel : sinon elle paraît
  // trop claire sur un ciel d'orage.
  // Sous l'orage, les gouttes s'assombrissent avec le ciel : peu de
  // contraste entre les traits de pluie et le ciel.
  for (const m of dropMaterials) {
    m.envMapIntensity = DROP_ENV_INTENSITY * (1 - storm * 0.85);
    m.specularIntensity = 1 - storm * 0.85;
    m.color.copy(DROP_COLOR).lerp(DROP_STORM_COLOR, storm);
    m.opacity = THREE.MathUtils.lerp(1, DROP_STORM_OPACITY, storm);
  }
  composer.render();
}

animate();
