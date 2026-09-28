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
const DROP_SIZE = 0.04;
// Chaque goutte a une taille tirée au hasard entre ces deux facteurs de
// DROP_SIZE (plus petite… ou plus grosse).
const DROP_SIZE_MIN = 0.12;
const DROP_SIZE_MAX = 1.3;
// Temps de traversée de l'écran (s), départ arrêté, en accélérant.
const DROP_FALL_TIME = 1.4;

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
function sendDropToPuddles(u, delay) {
  const { skyWidthPx, puddleWidthPx, puddleCount, mirrorX } = INSTALLATION;
  const totalPx = puddleWidthPx * puddleCount;
  // Position sous la goutte, en fraction de la largeur totale des flaques
  // (0 = bord gauche de la flaque 1, 1 = bord droit de la dernière).
  let x = ((totalPx - skyWidthPx) / 2 + u * skyWidthPx) / totalPx;
  if (mirrorX) x = 1 - x;
  // y : position en hauteur, tirée au hasard (la même pour toutes les
  // flaques). delay : secondes avant l'impact.
  const message = { type: "goutte", x, y: Math.random(), delay };
  // Par le serveur (serveur.py) et par le navigateur : chaque flaque
  // n'écoute que l'un des deux, donc pas de doublon.
  fetch("/onde", { method: "POST", body: JSON.stringify(message) }).catch(() => {});
  puddleChannel.postMessage(message);
}
const puddleChannel = new BroadcastChannel("eau-interferences");


let dropSource = null;
// Matériaux de la goutte (partagés par toutes les copies), pour ajuster
// leurs reflets selon l'orage.
const dropMaterials = [];
const DROP_ENV_INTENSITY = 1.2;
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
    color: 0xdde6e8,
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

function nowSeconds() {
  return Date.now() / 1000;
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
  stormDrops.push(params.t0);
  if (!dropSource) return;
  const drop = dropSource.clone();
  drop.scale.setScalar(params.scale);
  drop.position.set(params.x, params.y0, -DROP_DISTANCE);
  drop.userData = params;
  scene.add(drop);
  drops.push(drop);
}

function spawnDrop(event) {
  if (!dropSource) return;
  pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dropPlane, hit)) return;

  const bounds = screenBoundsAt(DROP_DISTANCE);
  const screenHeight = bounds.top - bounds.bottom;
  // Accélération telle que la goutte traverse l'écran « ciel » en
  // DROP_FALL_TIME ; ensuite elle garde cette vitesse (vitesse limite).
  const gravity = (2 * screenHeight * (1 + DROP_SIZE * 2)) / (DROP_FALL_TIME * DROP_FALL_TIME);
  const params = {
    // Même position horizontale que le clic, départ juste au-dessus du haut.
    x: hit.x,
    y0: bounds.top + screenHeight * DROP_SIZE,
    t0: nowSeconds(),
    gravity,
    maxSpeed: gravity * DROP_FALL_TIME,
    scale: (screenHeight * DROP_SIZE * THREE.MathUtils.randFloat(DROP_SIZE_MIN, DROP_SIZE_MAX)) / dropHeight,
    screenHeight,
  };
  addDrop(params);
  channel.postMessage({ type: "drop", params });
  sendDropToPuddles(event.clientX / window.innerWidth, impactDelay(params, bounds));
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
    drop.scale.set(p.scale / Math.sqrt(stretch), p.scale * stretch, p.scale / Math.sqrt(stretch));
    // Sortie par le bas de cet écran : on la retire.
    if (drop.position.y < bounds.bottom - p.screenHeight * DROP_SIZE * 3) {
      scene.remove(drop);
      drops.splice(i, 1);
    }
  }
}

if (SCREEN === "ciel") {
  renderer.domElement.addEventListener("pointerdown", spawnDrop);
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
  const storm = stormLevel(nowSeconds()) * STORM_MAX;
  uniforms.uStorm.value = storm;
  if (hemiLight) hemiLight.intensity = 1.6 * (1 - storm * 0.45);
  if (sunLight) sunLight.intensity = 1.1 * (1 - storm * 0.8);
  // Les reflets de la goutte s'éteignent avec le ciel : sinon elle paraît
  // trop claire sur un ciel d'orage.
  for (const m of dropMaterials) {
    m.envMapIntensity = DROP_ENV_INTENSITY * (1 - storm * 0.85);
    m.specularIntensity = 1 - storm * 0.7;
  }
  composer.render();
}

animate();
