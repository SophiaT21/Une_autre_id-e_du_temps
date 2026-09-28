import * as THREE from "three";

// GLSL partagé entre le vertex shader (déplacement des sommets) et le
// fragment shader (normale recalculée par pixel, pour un éclairage/spéculaire
// précis même avec un exposant élevé — pas d'interpolation de normale entre
// sommets, pas de computeVertexNormals()).
//
// waterField() combine :
//  - une houle ambiante basée sur du BRUIT (pas une somme de sinus propres) :
//    un bruit n'a pas de petite période exacte, donc pas de motif visible qui
//    se répète, contrairement à quelques vagues de Gerstner directionnelles.
//  - les ondes circulaires du clic (vagues de Gerstner "radiales").
// Les normales sont dérivées de ces deux contributions (gradient analytique
// pour les ondes du clic, différences finies pour le bruit).
function buildWaterFieldGLSL() {
  return `
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float swellNoise(vec2 p) {
      float v = 0.0;
      float amp = 0.7;
      float freq = 1.0;
      for (int i = 0; i < 2; i++) {
        v += amp * (valueNoise(p * freq) * 2.0 - 1.0);
        freq *= 1.8;
        amp *= 0.4;
      }
      return v;
    }
    // Basse fréquence + dérive lente dans le temps : de grandes taches
    // diffuses qui bougent doucement, jamais de motif qui se répète.
    float swellHeight(vec2 p, float time) {
      vec2 q = p * 0.045 + vec2(time * 0.02, time * 0.014);
      return swellNoise(q) * 0.07;
    }

    void accumulateRipples(vec2 p, float time, inout vec3 disp, inout vec2 nSum, inout float nzSum) {
      for (int i = 0; i < MAX_RIPPLES; i++) {
        if (i >= uRippleCount) break;
        // xy : point de départ, z : heure de départ.
        vec4 ripple = uRipples[i];
        float t = time - ripple.z;
        // Pas encore tombée (goutte du ciel en chute) ou terminée : ignorée.
        // (Les ondes de tempête, qui s'amortissent plus vite, vivent moins.)
        if (t < 0.0 || t > RIPPLE_LIFETIME / (1.0 + STORM_DECAY * ripple.w)) continue;

        vec2 offset = p - ripple.xy;
        float d = length(offset);
        vec2 dir = d > 0.0001 ? offset / d : vec2(0.0, 0.0);

        float speed = 2.6;
        // ripple.w : force de tempête de la goutte (0 = onde normale, 1 = en
        // pleine tempête). En tempête : anneaux plus serrés, plus fins et
        // plus bas, pour que l'eau reste lisible malgré la pluie battante.
        float stormy = ripple.w;
        // Longueur d'onde plus courte : anneaux plus fins, comme une goutte.
        float k = 3.8 * (1.0 + 0.6 * stormy);
        float w = k * speed;

        // Temps écoulé depuis que le front d'onde a atteint ce point.
        float localT = t - d / speed;
        float front = smoothstep(-0.1, 0.35, localT);
        // Les ondes de tempête s'éteignent vite : l'agitation de l'eau suit
        // la tempête du ciel et retombe avec elle.
        float decay = exp(-max(localT, 0.0) * 0.6 * (1.0 + STORM_DECAY * stormy));
        // Énergie qui s'étale sur un cercle de plus en plus grand : amplitude
        // en ~1/sqrt(d), plus une montée douce au tout début (pas d'impact
        // brutal au point de clic).
        float spatialFalloff = inversesqrt(1.0 + d * 0.5);
        float birth = smoothstep(0.0, 0.35, t);
        float envelope = front * decay * spatialFalloff * birth;
        if (envelope < 0.001) continue;

        float amplitude = 0.22 * (1.0 - 0.6 * stormy);
        float steepness = 0.35;
        float phase = d * k - t * w;
        float c = cos(phase) * envelope;
        float s = sin(phase) * envelope;

        disp.xy += steepness * amplitude * dir * c;
        disp.z += amplitude * s;
        nSum += dir * k * amplitude * c;
        nzSum += steepness * k * amplitude * s;
      }
    }

    void waterField(vec2 p, float time, out vec3 displacement, out vec3 normal) {
      vec3 disp = vec3(0.0);
      vec2 nSum = vec2(0.0);
      float nzSum = 0.0;

      float eps = 0.2;
      // Position dans la grande flaque (voir setLayout).
      vec2 pw = uFlip * p + uWorldOffset;
      float hC = swellHeight(pw, time);
      float hX = swellHeight(pw + vec2(eps, 0.0), time);
      float hY = swellHeight(pw + vec2(0.0, eps), time);
      disp.z += hC;
      // Pente calculée dans la grande flaque, ramenée au repère de l'écran.
      nSum += uFlip * vec2(hX - hC, hY - hC) / eps;

      accumulateRipples(p, time, disp, nSum, nzSum);

      displacement = vec3(p.x + disp.x, p.y + disp.y, disp.z);
      normal = normalize(vec3(-nSum.x, -nSum.y, 1.0 - nzSum));
    }
  `;
}

// Transformation écran → grande flaque (voir setLayout).
export function puddleLayout(index, halfHeight) {
  return index === 0
    ? { flip: 1, offset: new THREE.Vector2(0, 0) }
    : { flip: -1, offset: new THREE.Vector2(0, 2 * halfHeight) };
}

// Durée de vie d'une onde (s) : au-delà, elle est trop amortie pour se voir,
// même loin de son point de départ (elle met du temps à traverser l'écran).
const RIPPLE_LIFETIME = 25;
// Les ondes de tempête s'amortissent (1 + STORM_DECAY) fois plus vite.
const STORM_DECAY = 1.5;

export function createWater({ width, height, maxRipples, envMap, refractionMap }) {
  const geometry = new THREE.PlaneGeometry(width, height, 256, 256);

  // Une onde = un vec4 (x, y, heure de départ, inutilisé) : une seule case
  // de la mémoire du shader par onde, pour en garder le plus possible.
  const ripples = [];
  for (let i = 0; i < maxRipples; i++) ripples.push(new THREE.Vector4(0, 0, -999, 0));
  let rippleCursor = 0;

  const uniforms = {
    uTime: { value: 0 },
    // Le shader ne parcourt que les uRippleCount premières cases (voir update).
    uRippleCount: { value: 0 },
    uRipples: { value: ripples },
    // Palette d'eau naturelle (vert-gris désaturé) plutôt que turquoise vif.
    uDeepColor: { value: new THREE.Color(0x0f2427) },
    uShallowColor: { value: new THREE.Color(0x33504f) },
    uEdgeColor: { value: new THREE.Color(0x1e3535) },
    uGlowColor: { value: new THREE.Color(0xeef5f4) },
    // Feuillage d'automne : ombre brune, roux, rouge brique, or.
    uTreeDark: { value: new THREE.Color(0x1a0e06) },
    uTreeWarm: { value: new THREE.Color(0x7a3612) },
    uTreeRed: { value: new THREE.Color(0x7c2310) },
    uTreeGold: { value: new THREE.Color(0xa06a18) },
    // Plusieurs flaques côte à côte ne forment qu'une seule grande flaque
    // (voir setLayout) : houle, lumière et reflets d'arbres se raccordent.
    uFlip: { value: 1 },
    uWorldOffset: { value: new THREE.Vector2(0, 0) },
    // Demi-largeur et demi-hauteur visibles d'un écran (unités monde).
    uHalf: { value: new THREE.Vector2(1, 1) },
    uEnvMap: { value: envMap },
    uRefractionMap: { value: refractionMap },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };

  const waterFieldGLSL = buildWaterFieldGLSL();

  const vertexShader = `
    #define MAX_RIPPLES ${maxRipples}
    #define RIPPLE_LIFETIME ${RIPPLE_LIFETIME.toFixed(1)}
    #define STORM_DECAY ${STORM_DECAY.toFixed(2)}

    uniform float uTime;
    uniform int uRippleCount;
    uniform vec4 uRipples[MAX_RIPPLES];
    uniform vec2 uWorldOffset;
    uniform float uFlip;

    varying vec2 vBasePos;
    varying vec3 vWorldPos;

    ${waterFieldGLSL}

    void main() {
      vec2 p = position.xy;
      vec3 displaced;
      vec3 normalUnused;
      waterField(p, uTime, displaced, normalUnused);

      vBasePos = p;
      vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
      vWorldPos = worldPos.xyz;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `;

  const fragmentShader = `
    #define MAX_RIPPLES ${maxRipples}
    #define RIPPLE_LIFETIME ${RIPPLE_LIFETIME.toFixed(1)}
    #define STORM_DECAY ${STORM_DECAY.toFixed(2)}

    uniform float uTime;
    uniform int uRippleCount;
    uniform vec4 uRipples[MAX_RIPPLES];
    uniform vec2 uWorldOffset;
    uniform float uFlip;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uEdgeColor;
    uniform vec3 uGlowColor;
    uniform vec3 uTreeDark;
    uniform vec3 uTreeWarm;
    uniform vec3 uTreeRed;
    uniform vec3 uTreeGold;
    uniform vec2 uHalf;
    uniform samplerCube uEnvMap;
    uniform sampler2D uRefractionMap;
    uniform vec2 uResolution;

    varying vec2 vBasePos;
    varying vec3 vWorldPos;

    ${waterFieldGLSL}

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * valueNoise(p);
        p = p * 2.03 + 17.1;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 displaced;
      vec3 N;
      waterField(vBasePos, uTime, displaced, N);

      // Caméra orthographique : rayons de vue parallèles.
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      vec3 lightDir = normalize(vec3(0.3, 0.45, 0.7));
      vec3 halfDir = normalize(lightDir + viewDir);

      // La pente locale sert à distinguer le léger miroitement de repos
      // (toujours présent, très plat) des vraies vagues du clic (bien plus
      // pentues) : le hotspot spéculaire net n'apparaît que sur ces
      // dernières, jamais sur l'eau immobile.
      float slopeMag = length(N.xy);
      float waveActivity = smoothstep(0.09, 0.22, slopeMag);

      vec2 screenUV = gl_FragCoord.xy / uResolution;
      float aspect = uResolution.x / uResolution.y;

      // --- État plat : teinte vert-gris, plus sombre vers les bords pour
      // suggérer la profondeur, avec de grandes variations très lentes
      // (reflet d'un ciel couvert, nuages qui passent). ---
      // Position dans la grande flaque (voir setLayout), en unités monde puis
      // en unités de hauteur d'écran : qb.x ∈ [0, A] (A = largeur/hauteur
      // d'un écran), qb.y ∈ [0, 2] — flaque 1 en bas, flaque 2 au-dessus, le
      // bord commun à qb.y = 1.
      vec2 bigPos = uFlip * vBasePos + uWorldOffset;
      float A = uHalf.x / uHalf.y;
      vec2 qb = vec2(bigPos.x + uHalf.x, bigPos.y + uHalf.y) / (2.0 * uHalf.y);
      float edgeAmount = smoothstep(20.0, 60.0, length(bigPos - vec2(0.0, uHalf.y)));
      vec3 restColor = mix(uShallowColor, uEdgeColor, edgeAmount * 0.6);
      float clouds = fbm(bigPos * 0.035 + vec2(uTime * 0.006, uTime * 0.004) + N.xy * 2.0);
      restColor *= 0.7 + clouds * 0.6;
      // Ciel couvert plus lumineux d'un côté : léger dégradé diagonal.
      restColor *= mix(0.85, 1.12, smoothstep(0.0, 1.0, (qb.x / A) * 0.7 + (1.0 - qb.y * 0.5) * 0.3));

      // Réfraction : fond rendu à part (voir main.js), lu avec un décalage
      // d'écran basé sur la normale locale — la surface reste transparente
      // au repos, le fond se voit clairement à travers.
      vec2 refractedUV = clamp(screenUV + N.xy * 0.05, 0.001, 0.999);
      vec3 floorSample = texture2D(uRefractionMap, refractedUV).rgb;
      vec3 color = mix(floorSample, restColor, 0.85);

      // --- Reflets d'arbres d'automne sur les bords : masses sombres
      // irrégulières qui entrent depuis le bord de l'écran, à certains
      // endroits seulement. Échantillonnées avec un décalage par la normale
      // pour que les ondes du clic déforment aussi ces reflets. ---
      // Vent : balancement lent avec des rafales irrégulières (somme de
      // sinus de périodes non multiples), en unités monde.
      float wind = sin(uTime * 0.35) * 0.6 + sin(uTime * 0.83 + 1.3) * 0.3 + sin(uTime * 1.7 + 0.4) * 0.1;
      vec2 sway = vec2(wind * 0.5, sin(uTime * 0.5 + 0.7) * 0.12);
      // Le feuillage se déplace avec le vent : on décale l'échantillonnage.
      // (La normale est dans le repère de l'écran : uFlip la ramène dans
      // celui de la grande flaque.)
      vec2 tp = bigPos + uFlip * N.xy * 4.0 - sway;
      vec2 q = qb + uFlip * N.xy * 0.06;
      // Couronnes placées juste au-delà du bord de la grande flaque : seule
      // une partie entre dans l'image. Certaines sont à cheval sur la
      // jonction entre deux écrans. (x, y, rayon)
      float treeMask = 0.0;
      // Petites feuilles du contour qui frémissent plus vite que la masse.
      vec2 flutter = vec2(sin(uTime * 1.3), cos(uTime * 1.1)) * 0.25;
      float leafEdge = (fbm(tp * 0.35) - 0.5) * 0.45 + (fbm(tp * 1.1 + 4.0 + flutter) - 0.5) * 0.2;
      for (int i = 0; i < 9; i++) {
        vec3 c;
        // Bas de la flaque 1 (qb.y = 0)
        if (i == 0) c = vec3(A * 0.25, -0.12, 0.24);
        else if (i == 1) c = vec3(A * 0.72, -0.14, 0.20);
        // Bas de la flaque 2 (qb.y = 2)
        else if (i == 2) c = vec3(A * 0.35, 2.13, 0.24);
        else if (i == 3) c = vec3(A * 0.82, 2.10, 0.30);
        // Côté qb.x = 0, dont une à cheval sur la jonction (qb.y = 1)
        else if (i == 4) c = vec3(-0.08, 0.45, 0.28);
        else if (i == 5) c = vec3(-0.10, 1.02, 0.30);
        else if (i == 6) c = vec3(-0.10, 1.62, 0.24);
        // Côté qb.x = A, dont une à cheval sur la jonction
        else if (i == 7) c = vec3(A + 0.08, 0.62, 0.30);
        else c = vec3(A + 0.06, 1.30, 0.28);
        // Chaque couronne suit le vent (1 unité écran = 40 unités monde)
        // plus sa propre petite oscillation.
        float fi = float(i);
        c.xy += sway / 40.0 + vec2(sin(uTime * 0.9 + fi * 1.7), cos(uTime * 0.7 + fi * 2.3)) * 0.004;
        float d = length(q - c.xy) / c.z + leafEdge;
        treeMask = max(treeMask, 1.0 - smoothstep(0.78, 1.02, d));
      }
      // Trouées dans le feuillage où le ciel réapparaît.
      float holes = smoothstep(0.58, 0.8, fbm(tp * 0.7 + 5.3));
      treeMask *= 1.0 - holes * 0.4;
      // Grappes de feuilles de couleurs différentes, avec des zones d'ombre
      // entre elles pour garder du volume.
      vec3 treeColor = mix(uTreeDark, uTreeWarm, smoothstep(0.3, 0.65, fbm(tp * 0.25 + 11.0)));
      treeColor = mix(treeColor, uTreeRed, smoothstep(0.5, 0.75, fbm(tp * 0.18 + 23.0)) * 0.85);
      treeColor = mix(treeColor, uTreeGold, smoothstep(0.55, 0.8, fbm(tp * 0.3 + 37.0)) * 0.8);
      treeColor *= mix(0.45, 1.0, smoothstep(0.25, 0.6, fbm(tp * 0.6 + 2.0)));
      color = mix(color, treeColor, treeMask * 0.8);

      // Reflet large et doux façon ciel diffus : toujours présent, jamais de
      // hotspot ponctuel au repos (exposant bas = tache large).
      float cosTheta = max(dot(N, viewDir), 0.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - cosTheta, 5.0);
      vec3 reflectDir = reflect(-viewDir, N);
      vec3 skyColor = textureCube(uEnvMap, reflectDir).rgb;
      float specSoft = pow(max(dot(N, halfDir), 0.0), 10.0);
      // Là où un arbre se reflète, le ciel ne se reflète plus.
      color += skyColor * (fresnel * 0.12 + specSoft * 0.08) * (1.0 - treeMask * 0.8);

      // --- Vagues : contraste net crête / creux, jamais flou, piloté par la
      // hauteur locale ET la pente (pas la hauteur seule) — deux ondes qui
      // se croisent ressortent naturellement plus lumineuses puisqu'elles
      // s'additionnent déjà dans displaced.z / N avant d'arriver ici. ---
      float crestDrive = displaced.z * 5.5 + slopeMag * 1.2;
      float troughDrive = -displaced.z * 5.5 + slopeMag * 0.4;
      // Transitions plus larges et plus légères : l'onde assombrit ou
      // éclaircit l'eau par touches, sans bandes noires/blanches franches.
      float crestWhite = smoothstep(0.25, 0.9, crestDrive) * waveActivity;
      float troughDeep = smoothstep(0.25, 0.9, troughDrive) * waveActivity;

      color = mix(color, uDeepColor, troughDeep * 0.4);

      // Spéculaire net (Blinn-Phong, exposant élevé) : hotspot uniquement
      // là où il y a une vraie vague.
      float specSharp = pow(max(dot(N, halfDir), 0.0), 380.0);
      color += uGlowColor * specSharp * waveActivity * 0.9;

      // Crêtes plus claires mais pas blanc pur : de l'eau, pas de l'écume.
      // Crête : reflet du ciel un peu plus lumineux, pas du blanc.
      color = mix(color, mix(color, uGlowColor, 0.5), crestWhite * 0.35);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
  const mesh = new THREE.Mesh(geometry, material);

  // startTime : instant de départ de l'onde (par défaut maintenant) — une
  // onde venue de l'autre écran peut avoir démarré un peu plus tôt.
  // stormy : 0 = onde normale, 1 = onde fine de tempête (voir le shader).
  function addRipple(localPoint, startTime = uniforms.uTime.value, stormy = 0) {
    const slot = freeSlot();
    ripples[slot].set(localPoint.x, localPoint.y, startTime, stormy);
  }

  // Place pour une nouvelle onde : d'abord une onde terminée ; sinon la plus
  // ancienne déjà commencée (la plus faible) ; jamais une goutte du ciel
  // encore en chute, sauf si toutes le sont.
  function freeSlot() {
    const now = uniforms.uTime.value;
    let oldest = -1;
    let oldestAge = -Infinity;
    for (let i = 0; i < maxRipples; i++) {
      const age = now - ripples[i].z;
      const lifetime = RIPPLE_LIFETIME / (1 + STORM_DECAY * ripples[i].w);
      // Terminée, jamais utilisée, ou datant d'avant le retour à zéro du
      // temps commun (modulo une heure) : libre.
      if (age > lifetime || age < -60) return i;
      if (age >= 0 && age > oldestAge) {
        oldestAge = age;
        oldest = i;
      }
    }
    if (oldest >= 0) return oldest;
    const slot = rippleCursor;
    rippleCursor = (rippleCursor + 1) % maxRipples;
    return slot;
  }

  function update(time) {
    uniforms.uTime.value = time;
    // Les places libres sont prises en priorité par le début (freeSlot) :
    // les ondes actives restent groupées, le shader s'arrête après la
    // dernière.
    let count = 0;
    for (let i = 0; i < maxRipples; i++) {
      const age = time - ripples[i].z;
      const lifetime = RIPPLE_LIFETIME / (1 + STORM_DECAY * ripples[i].w);
      if (age <= lifetime && age >= -60) count = i + 1;
    }
    uniforms.uRippleCount.value = count;
  }

  // Place cette flaque dans la grande flaque formée par les deux écrans,
  // qui se touchent par leur bord HAUT (écrans tournés en sens opposés).
  // Repère de la grande flaque = repère de la flaque 1 ; la flaque 2 y est
  // retournée d'un demi-tour et posée au-dessus de son bord haut :
  //   grande = flip · locale + offset
  // halfWidth / halfHeight : demi-dimensions visibles d'un écran (monde).
  function setLayout(index, halfWidth, halfHeight) {
    const layout = puddleLayout(index, halfHeight);
    uniforms.uFlip.value = layout.flip;
    uniforms.uWorldOffset.value.copy(layout.offset);
    uniforms.uHalf.value.set(halfWidth, halfHeight);
  }

  function setResolution(w, h) {
    uniforms.uResolution.value.set(w, h);
  }

  return { mesh, addRipple, update, setResolution, setLayout };
}
