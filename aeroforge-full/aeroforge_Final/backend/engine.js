// engine.js — AeroForge AI Prediction Engine v2
// Supports both Anthropic Claude AI and local physics fallback
'use strict';

const { v4: uuidv4 } = require('uuid');

// ─── Try to load Anthropic SDK ────────────────────────────
let Anthropic = null;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch (e) {
  console.warn('\x1b[33m[engine] @anthropic-ai/sdk not found — AI mode unavailable\x1b[0m');
}

const AI_MODEL  = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
const AI_KEY    = process.env.ANTHROPIC_API_KEY;
const USE_AI    = !!(Anthropic && AI_KEY && AI_KEY !== 'your_api_key_here');

if (USE_AI) {
  console.log(`\x1b[36m[engine] Anthropic AI enabled — model: ${AI_MODEL}\x1b[0m`);
} else {
  console.log('\x1b[33m[engine] Using local physics engine (AI disabled)\x1b[0m');
}

// ─── Static data ──────────────────────────────────────────
const MATERIALS = {
  'aluminum-7075':    { label: 'Aluminum 7075-T6',       density: 2.81, uts: 503,  thermal: 175, fatigue: 1.0 },
  'titanium-ti6al4v': { label: 'Titanium Ti-6Al-4V',     density: 4.43, uts: 950,  thermal: 400, fatigue: 1.4 },
  'carbon-fiber':     { label: 'Carbon Fiber Composite',  density: 1.6,  uts: 600,  thermal: 250, fatigue: 1.2 },
  'inconel-718':      { label: 'Inconel 718',             density: 8.19, uts: 1035, thermal: 700, fatigue: 1.6 },
  'steel-4340':       { label: 'Steel 4340',              density: 7.85, uts: 745,  thermal: 350, fatigue: 1.1 },
};

const VALID_TYPES     = ['wing-rib', 'bracket', 'engine-mount', 'panel', 'stringer', 'bulkhead'];
const VALID_MATERIALS = Object.keys(MATERIALS);

const TYPE_TO_ZONE = {
  'wing-rib': 'wing', 'stringer': 'wing',
  'engine-mount': 'engine', 'bracket': 'landing-gear',
  'panel': 'fuselage', 'bulkhead': 'fuselage',
};

const ZONE_COLORS = {
  wing: '#00c8ff', fuselage: '#00ff99', engine: '#ff6b35',
  tail: '#c084fc', 'landing-gear': '#ffd60a',
};

const TYPE_LABELS = {
  'wing-rib': 'Wing Rib', 'bracket': 'Bracket',
  'engine-mount': 'Engine Mount', 'panel': 'Skin Panel',
  'stringer': 'Stringer', 'bulkhead': 'Bulkhead',
};

// ─── Validation ───────────────────────────────────────────
function validateParams(params) {
  const errors = [];
  if (!params.type || !VALID_TYPES.includes(params.type))
    errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
  if (!params.material || !VALID_MATERIALS.includes(params.material))
    errors.push(`material must be one of: ${VALID_MATERIALS.join(', ')}`);
  const num = (k, min, max) => {
    const v = Number(params[k]);
    if (isNaN(v) || v < min || v > max)
      errors.push(`${k} must be between ${min} and ${max}`);
  };
  num('length', 1, 10000); num('width', 1, 5000);
  num('thickness', 0.1, 200); num('load', 0.01, 10000);
  return errors;
}

// ─── Local physics engine (fallback) ─────────────────────
function predictLocal(params) {
  const mat = MATERIALS[params.material];
  const volume = (params.length * params.width * params.thickness) / 1e9; // mm³ → m³
  const weight = Math.round(volume * mat.density * 1e6) / 1000;           // kg
  const area   = (params.width * params.thickness) / 1e6;                 // mm² → m²
  const stress = Math.round(((params.load * 1000) / Math.max(area, 1e-6)) / 1e6 * 100) / 100; // MPa
  const sf     = Math.min(10, Math.max(0.3, mat.uts / Math.max(stress, 0.1)));
  const seed   = ((params.length * 7 + params.width * 13 + params.thickness * 31) % 100) / 100;
  const fatigue = Math.round(1e6 * sf * mat.fatigue * (0.7 + seed * 0.6));
  const score  = Math.min(99, Math.max(10, Math.round(
    Math.min(sf / 4, 1) * 40 +
    Math.max(0, 1 - weight / 50) * 30 +
    Math.min(fatigue / 5e6, 1) * 30
  )));
  return {
    stress: Math.round(stress * 100) / 100,
    weight: Math.round(weight * 1000) / 1000,
    safetyFactor: Math.round(sf * 100) / 100,
    fatigueCycles: fatigue,
    thermalLimit: mat.thermal,
    overallScore: score,
    source: 'local',
  };
}

// ─── Anthropic AI engine ──────────────────────────────────
async function predictWithAI(params, promptText) {
  const client = new Anthropic.default({ apiKey: AI_KEY });

  let systemPrompt = `You are AeroForge AI, a precise aerospace structural analysis engine. 
Return ONLY valid JSON, no markdown fences, no explanation. 
All numeric values must be realistic for real aerospace engineering.`;

  let userPrompt;

  if (promptText) {
    userPrompt = `Parse this aerospace design request and generate full component analysis:
"${promptText}"

Return JSON with this exact structure:
{
  "name": "descriptive component name (e.g. 'Titanium Wing Rib Type-A')",
  "type": "one of: wing-rib|bracket|engine-mount|panel|stringer|bulkhead",
  "material": "one of: aluminum-7075|titanium-ti6al4v|carbon-fiber|inconel-718|steel-4340",
  "zone": "one of: wing|fuselage|engine|tail|landing-gear",
  "params": {
    "type": "same as above",
    "material": "same as above",
    "length": <number mm>,
    "width": <number mm>,
    "thickness": <number mm>,
    "load": <number kN>
  },
  "prediction": {
    "stress": <realistic MPa>,
    "weight": <realistic kg>,
    "safetyFactor": <1.0 to 5.0>,
    "fatigueCycles": <100000 to 5000000>,
    "thermalLimit": <celsius based on material>,
    "overallScore": <0 to 100>,
    "source": "ai"
  }
}`;
  } else {
    const m = MATERIALS[params.material];
    userPrompt = `Analyze this aerospace component with precise structural calculations:
Component: ${TYPE_LABELS[params.type]}
Material: ${m.label} (density: ${m.density} g/cm³, UTS: ${m.uts} MPa, max temp: ${m.thermal}°C)
Dimensions: ${params.length}mm × ${params.width}mm × ${params.thickness}mm thick
Applied Load: ${params.load} kN

Return JSON:
{
  "name": "descriptive name",
  "type": "${params.type}",
  "material": "${params.material}",
  "zone": "${TYPE_TO_ZONE[params.type] || 'fuselage'}",
  "prediction": {
    "stress": <calculated MPa>,
    "weight": <calculated kg>,
    "safetyFactor": <material UTS / calculated stress, clamp 0.3-10>,
    "fatigueCycles": <based on safety factor and material>,
    "thermalLimit": ${m.thermal},
    "overallScore": <0-100 based on stress margin, weight efficiency, fatigue>,
    "source": "ai"
  }
}`;
  }

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content.map(b => b.text || '').join('').trim();
  const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(clean);
  return result;
}

// ─── Prompt parser (keyword fallback) ─────────────────────
function parsePrompt(prompt) {
  const l = prompt.toLowerCase();
  const r = {};
  if      (l.includes('wing rib'))     r.type = 'wing-rib';
  else if (l.includes('engine mount')) r.type = 'engine-mount';
  else if (l.includes('bulkhead'))     r.type = 'bulkhead';
  else if (l.includes('stringer'))     r.type = 'stringer';
  else if (l.includes('bracket'))      r.type = 'bracket';
  else if (l.includes('panel'))        r.type = 'panel';

  if      (l.includes('titanium'))             r.material = 'titanium-ti6al4v';
  else if (l.includes('carbon'))               r.material = 'carbon-fiber';
  else if (l.includes('inconel'))              r.material = 'inconel-718';
  else if (l.includes('steel'))                r.material = 'steel-4340';
  else if (/alumin/.test(l))                   r.material = 'aluminum-7075';

  if (/light|thin|uav|drone/.test(l))          { r.thickness = 2; r.width = 80; r.length = 300; }
  else if (/heavy|thick|robust|fighter/.test(l)){ r.thickness = 10; r.width = 150; r.length = 500; }

  if (/high.?load|extreme|max/.test(l))         r.load = 80;
  else if (/medium|moderate/.test(l))           r.load = 25;
  else if (/low.?load|light.?load/.test(l))     r.load = 5;

  const mm = l.match(/(\d+)\s*mm/);
  if (mm) r.length = Math.min(10000, parseInt(mm[1]));
  return r;
}

// ─── Build full component object ──────────────────────────
async function buildComponent(params, promptText) {
  const errors = validateParams(params);
  if (errors.length > 0) return { errors };

  const p = {
    type: params.type, material: params.material,
    length: Number(params.length), width: Number(params.width),
    thickness: Number(params.thickness), load: Number(params.load),
  };

  let aiResult = null;
  let prediction;
  let name, zone, color;

  if (USE_AI) {
    try {
      aiResult = await predictWithAI(p, null);
      prediction = { ...aiResult.prediction };
      name  = aiResult.name || `${TYPE_LABELS[p.type]} — ${p.material.split('-')[0].toUpperCase()}`;
      zone  = aiResult.zone || TYPE_TO_ZONE[p.type] || 'fuselage';
      color = ZONE_COLORS[zone] || '#00c8ff';
    } catch (err) {
      console.warn('\x1b[33m[engine] AI prediction failed, using local fallback:\x1b[0m', err.message);
      prediction = predictLocal(p);
      name  = `${TYPE_LABELS[p.type]} — ${MATERIALS[p.material].label.split(' ')[0]}`;
      zone  = TYPE_TO_ZONE[p.type] || 'fuselage';
      color = ZONE_COLORS[zone] || '#00c8ff';
    }
  } else {
    prediction = predictLocal(p);
    name  = `${TYPE_LABELS[p.type]} — ${MATERIALS[p.material].label.split(' ')[0]}`;
    zone  = TYPE_TO_ZONE[p.type] || 'fuselage';
    color = ZONE_COLORS[zone] || '#00c8ff';
  }

  return { id: uuidv4(), name, params: p, prediction, zone, color, createdAt: new Date().toISOString() };
}

// ─── Build from prompt ────────────────────────────────────
async function buildFromPrompt(promptText) {
  const DEFAULTS = { type: 'wing-rib', material: 'aluminum-7075', length: 300, width: 100, thickness: 4, load: 20 };

  if (USE_AI) {
    try {
      const aiResult = await predictWithAI(null, promptText);
      const params = aiResult.params || {
        type: aiResult.type || DEFAULTS.type,
        material: aiResult.material || DEFAULTS.material,
        length: 300, width: 100, thickness: 4, load: 20,
      };
      const zone  = aiResult.zone || TYPE_TO_ZONE[params.type] || 'fuselage';
      const color = ZONE_COLORS[zone] || '#00c8ff';
      return {
        id: uuidv4(),
        name: aiResult.name || `AI Component`,
        params,
        prediction: { ...aiResult.prediction, source: 'ai' },
        zone, color,
        createdAt: new Date().toISOString(),
        originalPrompt: promptText,
      };
    } catch (err) {
      console.warn('\x1b[33m[engine] AI prompt failed, using keyword parser:\x1b[0m', err.message);
    }
  }

  // Fallback: keyword parse + local physics
  const parsed = parsePrompt(promptText);
  const params = { ...DEFAULTS, ...parsed };
  const errors = validateParams(params);
  if (errors.length > 0) return { errors };

  const prediction = predictLocal(params);
  const zone  = TYPE_TO_ZONE[params.type] || 'fuselage';
  const color = ZONE_COLORS[zone] || '#00c8ff';
  return {
    id: uuidv4(),
    name: `AI Component — ${TYPE_LABELS[params.type]}`,
    params, prediction, zone, color,
    createdAt: new Date().toISOString(),
    originalPrompt: promptText,
  };
}

// ─── CAD / AutoCAD-level component geometry generator ────
// Produces parametric geometry descriptors: cross-sections, rib/spar
// layouts, flange geometry, tolerance callouts, material annotations,
// and a dimensioned multi-view drawing data structure — mirroring
// what an AutoCAD / CATIA parametric model would export.

const COMPONENT_PROFILES = {
  'wing-rib': {
    profile:     'I-BEAM',   // cross-section shape
    webThkFactor: 0.45,      // web thickness as fraction of flange width
    flangeWFactor: 0.30,     // flange width as fraction of part width
    flangeThkFactor: 0.18,   // flange thickness as fraction of total height
    lightHolePattern: 'ELLIPTIC_ARRAY',
    lightHoleCount: 5,
    lightHoleAspect: 1.6,    // width/height ratio of each hole
    lightHoleAreaFraction: 0.38,
    sealantGroove: true,
    rivetPitch: 25.4,        // mm (standard aerospace 1-inch pitch)
    rivetDia:   4.8,         // mm (3/16 inch AN-standard)
    edgeMargin: 12,          // mm from edge to first rivet
  },
  'bracket': {
    profile:     'CHANNEL',
    webThkFactor: 0.50,
    flangeWFactor: 0.80,
    flangeThkFactor: 0.22,
    boltPattern:   '4-BOLT-RECT',
    boltDia:        8,       // mm (M8)
    boltPitchX:    0.60,     // fraction of length
    boltPitchZ:    0.60,     // fraction of width
    edgeFilletR:   3,        // mm corner fillet
    gussetPresent: true,
  },
  'engine-mount': {
    profile:     'TUBULAR_RING',
    wallThkFactor: 0.12,
    flangeThkFactor: 0.20,
    flangeWFactor:  0.25,
    boltCircleDivisions: 8,
    boltDia:  12,            // M12
    weldSeamType: 'BUTT_CONTINUOUS',
    heatShieldPresent: true,
    dynamicLoadFactor: 3.5,  // g-load multiplier
  },
  'panel': {
    profile:     'FLAT_SHEET',
    stiffenerType: 'Z-STRINGER',
    stiffenerCount: 4,
    stiffenerPitchFactor: 0.22,
    rivetPitch: 20,
    rivetDia:   3.2,         // mm (#6 MS fastener)
    corrosionCoating: 'ALODINE_1200',
    sealantBead: 'PR-1422_B2',
    spliceJoints: true,
    laminaPlies: null,       // set for composites
  },
  'stringer': {
    profile:     'Z-SECTION',
    webThkFactor: 0.55,
    flangeWFactor: 0.35,
    flangeThkFactor: 0.15,
    runoutLength: 0.08,      // fraction of length tapered at each end
    clipsSpacing: 150,       // mm (clip / shear tie pitch)
    clipThk: 2,              // mm
    joggledEnd: true,
  },
  'bulkhead': {
    profile:     'DISC_RING',
    webThkFactor: 0.40,
    flangeWFactor: 0.18,
    flangeThkFactor: 0.22,
    lightHolePattern: 'RADIAL_ARRAY',
    lightHoleCount:  8,
    lightHoleAspect: 1.0,
    lightHoleAreaFraction: 0.30,
    pressureDecking: true,
    sealFaceFinish: 'RA_1.6',  // µm surface roughness
    sealingGrooveDia: 0.82,    // fraction of outer radius
  },
};

const MATERIAL_SPEC = {
  'aluminum-7075': {
    spec:    'AMS 2770-H/AMS-QQ-A-250/12',
    temper:  'T7351',
    E:       71.0,    // GPa Young's modulus
    G:       26.9,    // GPa shear modulus
    poisson: 0.33,
    CTE:     23.6,    // µm/m·°C coefficient of thermal expansion
    KIC:     24.0,    // MPa√m fracture toughness
    machining: 'CNC_MILL_5AXIS',
    finish:  'SULFURIC_ANODIZE_CLASS_2',
    surfaceRa: 1.6,
  },
  'titanium-ti6al4v': {
    spec:    'AMS 4928 / ASTM B265 Gr.5',
    temper:  'STA',
    E:       113.8,
    G:       44.0,
    poisson: 0.342,
    CTE:     8.6,
    KIC:     75.0,
    machining: 'HSM_TiAlN_COATED',
    finish:  'PASSIVATE_AMS_2700',
    surfaceRa: 0.8,
  },
  'carbon-fiber': {
    spec:    'AS4/8552 Prepreg / MIL-HDBK-17',
    temper:  'AUTOCLAVE_CURED_121C',
    E:       70.0,    // in-plane quasi-isotropic GPa
    G:       5.0,
    poisson: 0.30,
    CTE:     2.0,
    KIC:     30.0,
    machining: 'DIAMOND_ROUTER_WATERJET',
    finish:  'PRIMER_TOPCOAT_SKYDROL_RES',
    surfaceRa: 0.4,
    stackup:  '[45/0/-45/90]_2S',
    plies:    16,
    plyThk:   0.188, // mm per ply
  },
  'inconel-718': {
    spec:    'AMS 5662 / ASTM B637',
    temper:  'STA_760_620',
    E:       199.9,
    G:       76.0,
    poisson: 0.284,
    CTE:     13.0,
    KIC:     100.0,
    machining: 'EDM_SLOW_SPEED',
    finish:  'SHOT_PEEN_AMS_2430_INTENSITY_12A',
    surfaceRa: 0.8,
  },
  'steel-4340': {
    spec:    'AMS 6415 / ASTM A29',
    temper:  'H900',
    E:       200.0,
    G:       80.0,
    poisson: 0.29,
    CTE:     12.3,
    KIC:     55.0,
    machining: 'CNC_TURN_MILL',
    finish:  'CADMIUM_PLATE_AMS_QQ_P_416_TYPE_2',
    surfaceRa: 1.6,
  },
};

const TOLERANCE_CLASSES = {
  'critical':   { linear: '±0.05',  angular: '±0.1°',  flatness: '0.03',  cylindricity: '0.02',  GDT: 'ISO_8015' },
  'standard':   { linear: '±0.13',  angular: '±0.5°',  flatness: '0.10',  cylindricity: '0.05',  GDT: 'ISO_8015' },
  'rough':      { linear: '±0.25',  angular: '±1.0°',  flatness: '0.25',  cylindricity: '0.13',  GDT: 'ISO_8015' },
};

function getToleranceClass(type) {
  if (['engine-mount','bulkhead'].includes(type)) return 'critical';
  if (['wing-rib','bracket'].includes(type))       return 'standard';
  return 'rough';
}

function buildCADGeometry(params, matSpec, profile) {
  const L = params.length, W = params.width, T = params.thickness;
  const p = profile;

  // ── Cross-section dims ──────────────────────────────────
  const xSection = {};
  if (p.profile === 'I-BEAM') {
    xSection.type      = 'I-BEAM';
    xSection.H         = Math.round(T * 10) / 10;
    xSection.webThk    = Math.round(T * p.webThkFactor * 10) / 10;
    xSection.flangeW   = Math.round(W * p.flangeWFactor * 10) / 10;
    xSection.flangeThk = Math.round(T * p.flangeThkFactor * 10) / 10;
    xSection.filletR   = Math.round(Math.min(xSection.webThk, xSection.flangeThk) * 0.5 * 10) / 10;
  } else if (p.profile === 'CHANNEL') {
    xSection.type      = 'C-CHANNEL';
    xSection.H         = Math.round(T * 10) / 10;
    xSection.webThk    = Math.round(T * p.webThkFactor * 10) / 10;
    xSection.flangeW   = Math.round(W * p.flangeWFactor * 10) / 10;
    xSection.flangeThk = Math.round(T * p.flangeThkFactor * 10) / 10;
    xSection.filletR   = 3;
  } else if (p.profile === 'TUBULAR_RING') {
    xSection.type      = 'TUBE';
    xSection.OD        = Math.round(W * 10) / 10;
    xSection.wallThk   = Math.round(W * p.wallThkFactor * 10) / 10;
    xSection.ID        = Math.round((xSection.OD - 2 * xSection.wallThk) * 10) / 10;
  } else if (p.profile === 'FLAT_SHEET') {
    xSection.type      = 'FLAT';
    xSection.thickness = Math.round(T * 10) / 10;
    if (matSpec.plies) {
      xSection.plies    = Math.ceil(T / matSpec.plyThk);
      xSection.stackup  = matSpec.stackup;
    }
  } else if (p.profile === 'Z-SECTION') {
    xSection.type      = 'Z-SECTION';
    xSection.H         = Math.round(T * 10) / 10;
    xSection.webThk    = Math.round(T * p.webThkFactor * 10) / 10;
    xSection.flangeW   = Math.round(W * p.flangeWFactor * 10) / 10;
    xSection.flangeThk = Math.round(T * p.flangeThkFactor * 10) / 10;
    xSection.filletR   = 2;
  } else if (p.profile === 'DISC_RING') {
    xSection.type      = 'DISC';
    xSection.OD        = Math.round(W * 10) / 10;
    xSection.ID        = Math.round(W * 0.55 * 10) / 10;
    xSection.webThk    = Math.round(T * p.webThkFactor * 10) / 10;
    xSection.flangeW   = Math.round(W * p.flangeWFactor * 10) / 10;
    xSection.flangeThk = Math.round(T * p.flangeThkFactor * 10) / 10;
  }

  // ── Fastener layout ────────────────────────────────────
  const fasteners = [];
  if (p.rivetPitch) {
    const cols = Math.max(2, Math.floor((L - 2 * p.edgeMargin) / p.rivetPitch) + 1);
    const pitch = (L - 2 * p.edgeMargin) / Math.max(cols - 1, 1);
    for (let i = 0; i < cols; i++) {
      fasteners.push({
        x: Math.round((p.edgeMargin + i * pitch) * 10) / 10,
        y: Math.round(p.edgeMargin * 10) / 10,
        dia: p.rivetDia, type: 'RIVET_AN426',
      });
    }
  } else if (p.boltPattern === '4-BOLT-RECT') {
    const bx = L * p.boltPitchX / 2, bz = W * p.boltPitchZ / 2;
    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([sx,sz]) =>
      fasteners.push({ x: Math.round(L/2 + sx*bx), y: Math.round(W/2 + sz*bz), dia: p.boltDia, type: 'BOLT_M8_HEX', torque: '22 Nm' })
    );
  } else if (p.boltCircleDivisions) {
    const bcR = (xSection.OD || W) * 0.38;
    for (let i = 0; i < p.boltCircleDivisions; i++) {
      const a = (2 * Math.PI * i) / p.boltCircleDivisions;
      fasteners.push({
        x: Math.round(bcR * Math.cos(a) * 10) / 10,
        y: Math.round(bcR * Math.sin(a) * 10) / 10,
        dia: p.boltDia, type: 'BOLT_M12_HEX', torque: '70 Nm',
      });
    }
  }

  // ── Lightening holes ───────────────────────────────────
  const lightHoles = [];
  if (p.lightHolePattern === 'ELLIPTIC_ARRAY') {
    const usableL = L * 0.80, usableH = T * 0.55;
    const spacing = usableL / (p.lightHoleCount + 1);
    const hA = Math.round(usableH / 2 * 10) / 10;
    const hB = Math.round(hA / p.lightHoleAspect * 10) / 10;
    for (let i = 0; i < p.lightHoleCount; i++) {
      lightHoles.push({ cx: Math.round(L * 0.10 + (i + 1) * spacing), cy: Math.round(T / 2), a: hA, b: hB, type: 'ELLIPSE' });
    }
  } else if (p.lightHolePattern === 'RADIAL_ARRAY') {
    const r = (xSection.OD || W) * 0.20;
    const startR = (xSection.ID || W * 0.28) + r + 10;
    for (let i = 0; i < p.lightHoleCount; i++) {
      const a = (2 * Math.PI * i) / p.lightHoleCount + Math.PI / p.lightHoleCount;
      lightHoles.push({ cx: Math.round(startR * Math.cos(a)), cy: Math.round(startR * Math.sin(a)), r: Math.round(r), type: 'CIRCLE' });
    }
  }

  // ── Multi-view drawing frame (AutoCAD-style) ─────────────
  // Defines the bounding box and datum for each projection
  const drawingViews = [
    { view: 'FRONT', label: 'VIEW A-A', dims: { w: L, h: T }, scale: `1:${Math.ceil(L/200)}`, datum: 'A' },
    { view: 'TOP',   label: 'PLAN VIEW', dims: { w: L, h: W }, scale: `1:${Math.ceil(L/200)}`, datum: 'B' },
    { view: 'RIGHT_END', label: 'END VIEW', dims: { w: W, h: T }, scale: '1:1', datum: 'C' },
    { view: 'SECTION_AA', label: 'SECTION A-A', xSection, scale: '2:1' },
  ];

  // ── GD&T callouts ──────────────────────────────────────
  const tol = TOLERANCE_CLASSES[getToleranceClass(params.type)];
  const gdtCallouts = [
    { feature: 'Mounting_face', symbol: '⊟', value: tol.flatness + ' mm', datum: 'A' },
    { feature: 'Fastener_holes', symbol: '⌀', value: `${fasteners[0]?.dia || '-'} ±0.05 TRUE_POS_∅0.3 |A|B|C` },
    { feature: 'Part_length', symbol: '↔', value: `${L} ${tol.linear} mm` },
    { feature: 'Surface_finish', symbol: '∇', value: `Ra ${matSpec.surfaceRa} µm` },
  ];

  // ── Mass properties ────────────────────────────────────
  // (matches local physics engine calculation)
  const volMm3   = L * W * T;
  const density  = MATERIALS[params.material].density;  // g/cm³
  const massCOG  = { x: Math.round(L / 2), y: Math.round(W / 2), z: Math.round(T / 2) };

  return {
    profile: p.profile,
    xSection,
    fasteners,
    lightHoles,
    drawingViews,
    gdtCallouts,
    massCOG,
    volumeMm3: Math.round(volMm3),
    nominalMassKg: Math.round((volMm3 * density / 1e6) * 10000) / 10000,
  };
}

function buildCADTitleBlock(comp, matSpec, params) {
  const now = new Date();
  return {
    drawingNumber: `AF-${params.type.toUpperCase().replace(/-/g,'')}-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,
    revision:      'A',
    title:         comp.name,
    partNumber:    `AF-${comp.id.split('-')[0].toUpperCase()}`,
    material:      matSpec.spec,
    temper:        matSpec.temper,
    machining:     matSpec.machining,
    finish:        matSpec.finish,
    scale:         `1:${Math.ceil(params.length / 200)}`,
    projAngle:     'FIRST_ANGLE',  // ISO / DIN standard
    units:         'MM [IN]',
    drawnBy:       'AeroForge AI',
    checkedBy:     '—',
    approvedBy:    '—',
    date:          now.toISOString().slice(0, 10),
    standard:      'AS9100D / ISO_9001-2015',
    toleranceNote: `UNLESS OTHERWISE SPECIFIED: LINEAR ${TOLERANCE_CLASSES[getToleranceClass(params.type)].linear} mm  ANGULAR ${TOLERANCE_CLASSES[getToleranceClass(params.type)].angular}`,
    notes: [
      `1. MATERIAL PER ${matSpec.spec}`,
      `2. SURFACE FINISH: Ra ${matSpec.surfaceRa} µm MAX UNLESS NOTED`,
      `3. REMOVE ALL BURRS AND SHARP EDGES (0.2–0.5 CHAMFER)`,
      `4. DIMENSIONS IN MILLIMETRES`,
      `5. DO NOT SCALE DRAWING`,
    ],
  };
}

async function buildCADComponent(params) {
  const errors = validateParams(params);
  if (errors.length > 0) return { errors };

  const p = {
    type: params.type, material: params.material,
    length: Number(params.length), width: Number(params.width),
    thickness: Number(params.thickness), load: Number(params.load),
  };

  // Get structural prediction (reuse existing pipeline)
  const baseComp = await buildComponent(p);
  if (baseComp.errors) return baseComp;

  const profile = COMPONENT_PROFILES[p.type];
  const matSpec = MATERIAL_SPEC[p.material];
  const cadGeo  = buildCADGeometry(p, matSpec, profile);
  const titleBlock = buildCADTitleBlock(baseComp, matSpec, p);

  return {
    ...baseComp,
    cad: {
      version:    '2.0',
      format:     'AeroForge-CAD-JSON',
      titleBlock,
      geometry:   cadGeo,
      materialSpec: matSpec,
      profile:    profile.profile,
      toleranceClass: getToleranceClass(p.type),
    },
  };
}

module.exports = {
  buildComponent, buildFromPrompt, buildCADComponent,
  parsePrompt, validateParams,
  VALID_TYPES, VALID_MATERIALS, USE_AI,
  COMPONENT_PROFILES, MATERIAL_SPEC,
  generateVariations,
};

// ─── Generate design variations for comparison ────────────
async function generateVariations(baseParams) {
  const DEFAULTS = { type: 'wing-rib', material: 'aluminum-7075', length: 400, width: 120, thickness: 5, load: 25 };
  const p = { ...DEFAULTS, ...baseParams };

  // 4 design variants: different materials/geometry tweaks
  const variants = [
    { label: 'Design A', material: p.material,              thickness: Number(p.thickness),       width: Number(p.width) },
    { label: 'Design B', material: 'titanium-ti6al4v',      thickness: Number(p.thickness) * 0.85, width: Number(p.width) * 1.1 },
    { label: 'Design C', material: 'carbon-fiber',          thickness: Number(p.thickness) * 0.7,  width: Number(p.width) * 1.2 },
    { label: 'Design D', material: 'aluminum-7075',         thickness: Number(p.thickness) * 1.2,  width: Number(p.width) * 0.9 },
  ];

  const results = [];
  for (const v of variants) {
    const params = {
      type: p.type, load: Number(p.load),
      length: Number(p.length),
      material: v.material,
      width: Math.round(v.width),
      thickness: Math.round(v.thickness * 10) / 10,
    };
    // Ensure minimums
    if (params.thickness < 0.5) params.thickness = 0.5;
    if (params.width < 10) params.width = 10;

    const errors = validateParams(params);
    if (errors.length > 0) { results.push({ label: v.label, error: errors.join(', ') }); continue; }
    const prediction = predictLocal(params);
    const zone  = TYPE_TO_ZONE[params.type] || 'fuselage';
    const mat   = MATERIALS[params.material];
    const failureRisk = prediction.safetyFactor < 1.5 ? 'HIGH' : prediction.safetyFactor < 2.5 ? 'MEDIUM' : 'LOW';
    const recommendation = generateRecommendation(v.label, params, prediction, failureRisk);
    results.push({
      label: v.label,
      params, prediction, zone,
      material: mat.label,
      failureRisk,
      recommendation,
      color: ZONE_COLORS[zone] || '#00c8ff',
      id: require('uuid').v4(),
    });
  }
  return results;
}

function generateRecommendation(label, params, pred, risk) {
  const mat = MATERIALS[params.material];
  if (pred.safetyFactor >= 3 && pred.weight < 5 && pred.overallScore >= 75)
    return `${label}: Optimal balance — high safety factor (${pred.safetyFactor}×), low weight (${pred.weight} kg), score ${pred.overallScore}. Recommended.`;
  if (pred.safetyFactor < 1.5)
    return `${label}: High stress risk — safety factor ${pred.safetyFactor}× below threshold. Material stress exceeds safe limits under ${params.load} kN load.`;
  if (pred.weight > 20)
    return `${label}: Excessive weight (${pred.weight} kg) with ${mat.label}. Consider lighter composite alternative.`;
  return `${label}: Acceptable design — SF ${pred.safetyFactor}×, weight ${pred.weight} kg, aero score ${pred.overallScore}. ${risk === 'MEDIUM' ? 'Monitor stress concentrations.' : 'Structurally sound.'}`;
}


