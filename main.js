import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createWater, puddleLayout } from "./water.js";
import { createFloor } from "./floor.js";
import { createEnvMap } from "./sky.js";

const container = document.getElementById("app");

const pixelRatio = Math.min(window.devicePixelRatio, 2);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x6fdccd, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Vue de dessus : caméra orthographique, aucune perspective.
const VIEW_HEIGHT = 40;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
camera.position.set(0, 0, 50);
camera.lookAt(0, 0, 0);

function updateCameraFrustum() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfHeight = VIEW_HEIGHT / 2;
  const halfWidth = halfHeight * aspect;
  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
}
updateCameraFrustum();

// Assez large pour couvrir l'écran même en format très large.
const WIDTH = 120;
const HEIGHT = 56;

// --- Fond sableux : rendu dans sa propre scène/texture --------------------
// (c'est cette texture que l'eau échantillonne en réfraction, avec un
// décalage basé sur sa normale locale).
const floorScene = new THREE.Scene();
floorScene.add(createFloor(WIDTH, HEIGHT));

const floorRenderTarget = new THREE.WebGLRenderTarget(
  window.innerWidth * pixelRatio,
  window.innerHeight * pixelRatio
);

// Le fond est statique (pas de terme temporel dans son shader) : on le rend
// une fois, pas à chaque frame.
function renderFloor() {
  renderer.setRenderTarget(floorRenderTarget);
  renderer.render(floorScene, camera);
  renderer.setRenderTarget(null);
}

// --- Environnement : ciel statique capturé une fois pour la réflexion -----
const envMap = createEnvMap(renderer);

// --- Eau --------------------------------------------------------------
// Nombre d'ondes gardées en même temps par écran (chaque clic compte sur les
// deux écrans, plus les gouttes du ciel) : le maximum que la carte graphique
// accepte (une case de mémoire du shader par onde, on en laisse 40 pour le
// reste), plafonné à 256.
const MAX_RIPPLES = Math.max(
  24,
  Math.min(
    256,
    renderer.capabilities.maxVertexUniforms - 40,
    renderer.capabilities.maxFragmentUniforms - 40
  )
);
// Deux flaques (voir plus bas) : flaque.html = écran 0 (à gauche),
// flaque2.html = écran 1 (à droite). Écrans verticaux tournés en sens
// opposés, qui se touchent par leur bord HAUT : ils forment une seule grande
// flaque (voir setLayout dans water.js).
const SCREEN_INDEX = Number(document.body.dataset.ecran || 0);

const water = createWater({
  width: WIDTH,
  height: HEIGHT,
  maxRipples: MAX_RIPPLES,
  envMap,
  refractionMap: floorRenderTarget.texture,
});
water.setLayout(SCREEN_INDEX, camera.right, camera.top);
scene.add(water.mesh);
water.setResolution(window.innerWidth * pixelRatio, window.innerHeight * pixelRatio);
renderFloor();

// --- Post-traitement : bloom sur les hautes lumières spéculaires ----------
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(
    window.innerWidth * pixelRatio,
    window.innerHeight * pixelRatio,
    { type: THREE.HalfFloatType }
  )
);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35,
  0.4,
  0.8
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// --- Deux écrans d'eau reliés -----------------------------------------------
// flaque.html (écran 0) et flaque2.html (écran 1, data-ecran="1") forment une
// seule grande flaque. Chaque clic est envoyé à l'autre écran, en
// coordonnées de la grande flaque ; il crée la même onde au même endroit :
// elle démarre hors de son champ et arrive par le bord commun (le bord haut).
//
// Les ondes passent par le serveur local (serveur.py) : ça marche entre
// fenêtres, navigateurs et même ordinateurs différents. Si la page est servie
// par un autre serveur, on se replie sur un canal du navigateur (même
// navigateur, même machine seulement).
const CLIENT_ID = Math.random().toString(36).slice(2);
let useServer = false;
let channel = null;

function sendRipple(message) {
  const data = { ...message, from: CLIENT_ID };
  if (useServer) {
    fetch("/onde", { method: "POST", body: JSON.stringify(data) }).catch(() => {});
  } else if (channel) {
    channel.postMessage(data);
  }
}

// Passage repère de cet écran ↔ repère de la grande flaque.
function toBig(local) {
  const { flip, offset } = puddleLayout(SCREEN_INDEX, camera.top);
  return new THREE.Vector2(flip * local.x + offset.x, flip * local.y + offset.y);
}
function toLocal(big) {
  const { flip, offset } = puddleLayout(SCREEN_INDEX, camera.top);
  return new THREE.Vector2(flip * (big.x - offset.x), flip * (big.y - offset.y));
}

// Goutte tombée de l'écran ciel (voir ciel.js) : x = position de gauche à
// droite dans l'installation (0 = bord gauche de la flaque 1, 1 = bord droit
// de la flaque 2), y = position en profondeur (0-1, au hasard), delay =
// secondes avant l'impact, storm = force de la tempête quand la goutte est
// partie (0-1) : ondes plus fines en tempête.
// Écrans tournés : la gauche→droite de l'installation suit la hauteur de la
// grande flaque (bas de la flaque 1 → bas de la flaque 2), la profondeur
// suit sa largeur.
function receiveDrop({ x, y, delay, storm = 0 }) {
  const hw = camera.right;
  const hh = camera.top;
  const big = new THREE.Vector2(-hw + y * 2 * hw, -hh + x * 4 * hh);
  const local = toLocal(big);
  water.addRipple(local, sharedTime() + delay, storm);
  // Bruit de la goutte au moment où elle touche l'eau.
  if (isOnScreen(local)) setTimeout(playDropSound, Math.max(0, delay) * 1000);
}

// --- Son des gouttes qui tombent dans l'eau ---------------------------------

// Un des trois sons, au hasard (jamais deux fois le même de suite), joué par
// l'écran où tombe la goutte seulement (pas de doublon entre les flaques).
const DROP_SOUND_FILES = ["Goutte1.mp3", "Goutte2.mp3", "Goutte3.mp3"];
// Chaque goutte a sa propre intensité, tirée au hasard entre ces deux
// volumes (0-1) : gouttes plus ou moins fortes, plus ou moins proches.
const DROP_SOUND_MIN_VOLUME = 0.25;
const DROP_SOUND_MAX_VOLUME = 1;
// Nombre maximum de sons de goutte en même temps sur un écran (pendant la
// tempête, les gouttes suivantes restent muettes).
const MAX_DROP_SOUNDS = 8;
const dropSounds = DROP_SOUND_FILES.map((file) => {
  const sound = new Audio(file);
  sound.preload = "auto";
  return sound;
});
let lastDropSound = -1;
let playingDropSounds = 0;

function isOnScreen(local) {
  return Math.abs(local.x) <= camera.right && Math.abs(local.y) <= camera.top;
}

function playDropSound() {
  if (playingDropSounds >= MAX_DROP_SOUNDS) return;
  let i = Math.floor(Math.random() * dropSounds.length);
  if (i === lastDropSound && dropSounds.length > 1) i = (i + 1) % dropSounds.length;
  lastDropSound = i;
  const sound = dropSounds[i].cloneNode();
  sound.volume = THREE.MathUtils.randFloat(DROP_SOUND_MIN_VOLUME, DROP_SOUND_MAX_VOLUME);
  playingDropSounds++;
  const done = () => {
    playingDropSounds--;
    sound.onended = sound.onerror = null;
  };
  sound.onended = done;
  sound.onerror = done;
  // Chrome bloque le son sans clic, sauf flaque ouverte avec flaque1_son.bat ou flaque2_son.bat.
  sound.play().catch(done);
}

// --- Lumière des éclairs de l'écran ciel, reflétée par l'eau --------------

// Dernier éclair : heure de réception (temps local) et force.
let lightning = { start: -Infinity, flash: 0 };

// Même courbe que le flash du ciel (voir lightningEnvelope, ciel.js) :
// scintillements successifs rapides puis lueur qui s'éteint.
function lightningEnvelope(dt) {
  if (dt < 0 || dt > 1.2) return 0;
  const pulse = (c, w) => Math.exp(-(((dt - c) / w) ** 2));
  return Math.min(1, pulse(0.03, 0.045) + 0.65 * pulse(0.17, 0.05) + 0.45 * pulse(0.34, 0.08) + 0.2 * Math.exp(-dt * 4));
}

function updateLightning() {
  const dt = performance.now() / 1000 - lightning.start;
  water.setLightning(lightningEnvelope(dt) * lightning.flash);
}

// --- Assombrissement du ciel (orage), reflété par l'eau -------------------

// Dernière valeur reçue de l'écran ciel, et valeur affichée : elle la
// rejoint en douceur (les messages arrivent quelques fois par seconde).
let skyStorm = 0;
let shownStorm = 0;
let lastStormFrame = performance.now();

function updateStorm() {
  const now = performance.now();
  const dt = (now - lastStormFrame) / 1000;
  lastStormFrame = now;
  shownStorm += (skyStorm - shownStorm) * (1 - Math.exp(-dt / 0.3));
  water.setStorm(shownStorm);
}

function receiveRipple(data) {
  if (data.from === CLIENT_ID) return;
  if (data.type === "ciel") {
    skyStorm = data.storm;
    return;
  }
  // État du parapluie : pour l'écran ciel seulement.
  if (data.type === "umbrella") return;
  if (data.type === "goutte") {
    receiveDrop(data);
    return;
  }
  if (data.type === "eclair") {
    lightning = { start: performance.now() / 1000, flash: data.flash };
    return;
  }
  const { bx, by, t } = data;
  // t : heure de départ de l'onde, dans le temps commun (voir sharedTime).
  water.addRipple(toLocal(new THREE.Vector2(bx, by)), t);
}

// Temps commun à tous les écrans : l'heure du serveur (et non le chargement
// de la page), pour que vent, houle et ondes soient synchronisés, même entre
// deux ordinateurs dont les horloges diffèrent un peu. Modulo une heure pour
// garder de la précision dans les shaders.
let clockOffset = 0;

function sharedTime() {
  return (Date.now() / 1000 + clockOffset) % 3600;
}

// Mesure l'écart avec l'horloge du serveur : plusieurs essais, on garde le
// plus rapide (le moins perturbé par le réseau).
async function syncClock() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now() / 1000;
    const response = await fetch("/temps", { cache: "no-store" });
    const { t } = await response.json();
    const t1 = Date.now() / 1000;
    if (!best || t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: t - (t0 + t1) / 2 };
  }
  clockOffset = best.offset;
}

async function connect() {
  try {
    await syncClock();
    useServer = true;
    const events = new EventSource("/evenements");
    events.onmessage = (event) => receiveRipple(JSON.parse(event.data));
    // Recale l'horloge de temps en temps.
    setInterval(() => syncClock().catch(() => {}), 60000);
  } catch {
    // Pas de serveur.py : canal du navigateur.
    channel = new BroadcastChannel("eau-interferences");
    channel.addEventListener("message", (event) => receiveRipple(event.data));
  }
}
connect();

// --- Interaction : clic = onde d'interférence -------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(water.mesh, false);
  if (hits.length > 0) {
    const local = water.mesh.worldToLocal(hits[0].point.clone());
    water.addRipple(local);
    playDropSound();
    // Position par rapport au bord commun, et heure du clic.
    const big = toBig(local);
    sendRipple({ bx: big.x, by: big.y, t: sharedTime() });
  }
}

renderer.domElement.addEventListener("pointerdown", onPointerDown);

window.addEventListener("resize", () => {
  updateCameraFrustum();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);

  const w = window.innerWidth * pixelRatio;
  const h = window.innerHeight * pixelRatio;
  floorRenderTarget.setSize(w, h);
  water.setResolution(w, h);
  water.setLayout(SCREEN_INDEX, camera.right, camera.top);
  renderFloor();
});

function animate() {
  requestAnimationFrame(animate);
  water.update(sharedTime());
  updateLightning();
  updateStorm();
  composer.render();
}

animate();
