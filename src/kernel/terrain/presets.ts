/**
 * Genre presets for Base Studio: how the ground is built and which prop
 * families go on it. Numbers come from docs/research/basing-practice.md
 * (28-32 mm scale features, 3-5 element families, density that reads right,
 * sci-fi must foreground man-made or alien geometry rather than dirt).
 */
import type { NoiseParams } from './heightfield';
import type { StampId } from './stamps';

export type PropFamily = 'rock' | 'debris' | 'scifi' | 'ruin' | 'alien' | 'ground' | 'wood' | 'bone';

export interface GroundRecipe {
  /** base roughness */
  noise: Omit<NoiseParams, 'seed'>;
  /** tiled procedural stamps laid over the whole board, strongest first */
  tiles?: { stamp: StampId; strength: number; size: number; rotDeg?: number }[];
  /** random single stamps scattered about (per 100 cm²) */
  scatterStamps?: { stamp: StampId; strength: number; size: [number, number]; per100cm2: number; mode?: 'add' | 'max' | 'min' }[];
  /** relief above the plate top the ground itself may reach, mm */
  reliefCap: number;
}

export interface GenrePreset {
  id: string;
  label: string;
  /** one line for the UI */
  help: string;
  world: 'fantasy' | 'scifi' | 'historical' | 'any';
  ground: GroundRecipe;
  /** prop families and their pick weights (3-5 per the hobby rule) */
  families: { family: PropFamily; weight: number }[];
  density: 'light' | 'medium' | 'heavy';
  /** tallest prop the preset wants on a 40-60 mm base, mm */
  heightCap: number;
}

const flatNoise = (amp: number, scale: number, ridged = 0): GroundRecipe['noise'] => ({ amplitude: amp, scale, octaves: 4, persistence: 0.5, lacunarity: 2, ridged });

export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: 'temple-ruins', label: 'Temple ruins', world: 'fantasy',
    help: 'Cracked flagstones, broken columns and a little rubble; one fallen piece as the centrepiece.',
    ground: { noise: flatNoise(0.5, 12), tiles: [{ stamp: 'cracks', strength: -0.35, size: 40 }], reliefCap: 1.5 },
    families: [{ family: 'ruin', weight: 3 }, { family: 'debris', weight: 2 }, { family: 'rock', weight: 1 }],
    density: 'medium', heightCap: 12,
  },
  {
    id: 'city-ruins', label: 'City ruins', world: 'any',
    help: 'Shattered concrete, rebar and rubble mounds; uneven and busy.',
    ground: { noise: flatNoise(1.6, 9, 0.5), tiles: [{ stamp: 'cracks', strength: -0.4, size: 30 }], reliefCap: 3 },
    families: [{ family: 'debris', weight: 4 }, { family: 'ruin', weight: 2 }, { family: 'scifi', weight: 1 }],
    density: 'heavy', heightCap: 12,
  },
  {
    id: 'forest-floor', label: 'Forest floor', world: 'fantasy',
    help: 'Soft leaf litter and roots with the odd log and stone; mostly flat.',
    ground: { noise: flatNoise(1.0, 7), scatterStamps: [{ stamp: 'pebbles', strength: 0.4, size: [8, 14], per100cm2: 2 }], reliefCap: 2 },
    families: [{ family: 'wood', weight: 3 }, { family: 'rock', weight: 2 }, { family: 'ground', weight: 1 }],
    density: 'light', heightCap: 8,
  },
  {
    id: 'swamp', label: 'Swamp', world: 'fantasy',
    help: 'Low mud banks around flat pools; reeds and dead roots, almost nothing tall.',
    ground: { noise: flatNoise(0.8, 15), scatterStamps: [{ stamp: 'craters', strength: -0.6, size: [12, 20], per100cm2: 1.5, mode: 'min' }], reliefCap: 1.2 },
    families: [{ family: 'wood', weight: 3 }, { family: 'ground', weight: 2 }],
    density: 'light', heightCap: 5,
  },
  {
    id: 'snow', label: 'Snow', world: 'any',
    help: 'Drifted snow with rocks poking through; low, smooth mounds.',
    ground: { noise: flatNoise(1.4, 14), tiles: [{ stamp: 'ripples', strength: 0.25, size: 40, rotDeg: 20 }], reliefCap: 2.5 },
    families: [{ family: 'rock', weight: 3 }, { family: 'wood', weight: 1 }],
    density: 'light', heightCap: 8,
  },
  {
    id: 'desert', label: 'Desert', world: 'any',
    help: 'Cracked dry earth and sand ripples, a few rocks and bones.',
    ground: { noise: flatNoise(0.6, 12), tiles: [{ stamp: 'cracks', strength: -0.3, size: 36 }, { stamp: 'ripples', strength: 0.2, size: 40, rotDeg: 70 }], reliefCap: 1.5 },
    families: [{ family: 'rock', weight: 3 }, { family: 'bone', weight: 1 }],
    density: 'light', heightCap: 8,
  },
  {
    id: 'lava', label: 'Lava field', world: 'fantasy',
    help: 'Jagged basalt with glowing cracks between the crust plates.',
    ground: { noise: flatNoise(2.0, 8, 0.7), tiles: [{ stamp: 'cracks', strength: -0.9, size: 32 }], reliefCap: 3.5 },
    families: [{ family: 'rock', weight: 4 }],
    density: 'medium', heightCap: 10,
  },
  {
    id: 'graveyard', label: 'Graveyard', world: 'fantasy',
    help: 'Broken earth and gravel with headstones as the verticals.',
    ground: { noise: flatNoise(0.9, 10), scatterStamps: [{ stamp: 'pebbles', strength: 0.35, size: [8, 12], per100cm2: 2 }], reliefCap: 1.5 },
    families: [{ family: 'ruin', weight: 3 }, { family: 'bone', weight: 1 }, { family: 'rock', weight: 1 }],
    density: 'medium', heightCap: 10,
  },
  {
    id: 'scifi-deck', label: 'Sci-fi deck plating', world: 'scifi',
    help: 'Panel seams and rivets with grating strips, pipes and crates; flat plating, not dirt.',
    ground: { noise: flatNoise(0.08, 20), tiles: [{ stamp: 'plating', strength: 0.5, size: 40 }], scatterStamps: [{ stamp: 'grating', strength: 0.5, size: [10, 18], per100cm2: 1, mode: 'max' }], reliefCap: 0.8 },
    families: [{ family: 'scifi', weight: 5 }, { family: 'debris', weight: 1 }],
    density: 'medium', heightCap: 10,
  },
  {
    id: 'scifi-hive', label: 'Sci-fi hive rubble', world: 'scifi',
    help: 'Collapsed hive city: concrete slabs, twisted rebar, cable snarls, tech debris.',
    ground: { noise: flatNoise(1.5, 8, 0.4), tiles: [{ stamp: 'cracks', strength: -0.4, size: 28 }], reliefCap: 3 },
    families: [{ family: 'debris', weight: 4 }, { family: 'scifi', weight: 3 }],
    density: 'heavy', heightCap: 12,
  },
  {
    id: 'ash-wastes', label: 'Ash wastes', world: 'scifi',
    help: 'Fine ash drifts and ripples over corroded scrap and old bones.',
    ground: { noise: flatNoise(1.2, 16), tiles: [{ stamp: 'ripples', strength: 0.3, size: 40, rotDeg: 35 }], reliefCap: 2 },
    families: [{ family: 'scifi', weight: 2 }, { family: 'debris', weight: 2 }, { family: 'bone', weight: 1 }],
    density: 'light', heightCap: 8,
  },
  {
    id: 'alien-jungle', label: 'Alien jungle', world: 'scifi',
    help: 'Organic loam with crystal growths and strange spikes; saturated shapes against soft ground.',
    ground: { noise: flatNoise(1.3, 9), scatterStamps: [{ stamp: 'pebbles', strength: 0.5, size: [10, 16], per100cm2: 2 }], reliefCap: 2.5 },
    families: [{ family: 'alien', weight: 4 }, { family: 'rock', weight: 1 }],
    density: 'medium', heightCap: 14,
  },
  {
    id: 'lunar', label: 'Lunar regolith', world: 'scifi',
    help: 'Fine regolith with crater rims and a few boulders; nothing grows here.',
    ground: { noise: flatNoise(0.7, 11), scatterStamps: [{ stamp: 'craters', strength: 0.9, size: [10, 22], per100cm2: 2 }], reliefCap: 2 },
    families: [{ family: 'rock', weight: 4 }, { family: 'scifi', weight: 1 }],
    density: 'light', heightCap: 8,
  },
  {
    id: 'trench', label: 'Trench line', world: 'historical',
    help: 'Churned mud with duckboards, spent shells and the odd stake.',
    ground: { noise: flatNoise(1.8, 8, 0.3), reliefCap: 3 },
    families: [{ family: 'wood', weight: 3 }, { family: 'debris', weight: 2 }],
    density: 'medium', heightCap: 8,
  },
  {
    id: 'cobbled-street', label: 'Cobbled street', world: 'any',
    help: 'Even cobbles with cracks and a little battle debris; near-flat.',
    ground: { noise: flatNoise(0.1, 20), tiles: [{ stamp: 'cobbles', strength: 0.7, size: 40 }], reliefCap: 0.9 },
    families: [{ family: 'debris', weight: 2 }, { family: 'ruin', weight: 1 }],
    density: 'light', heightCap: 6,
  },
];

export function genrePreset(id: string): GenrePreset {
  return GENRE_PRESETS.find((p) => p.id === id) ?? GENRE_PRESETS[0];
}
