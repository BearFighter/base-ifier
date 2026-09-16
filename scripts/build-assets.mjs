#!/usr/bin/env node
/**
 * Build the bundled CC0 prop pack for Base Studio from Poly Haven (CC0,
 * https://polyhaven.com/license; their API terms ask third-party apps to send a
 * unique User-Agent and to name the source, which the app does).
 *
 *   node scripts/build-assets.mjs            # fetch + decimate into public/assets/packs/core
 *   node scripts/build-assets.mjs --list     # print the curated list and exit
 *
 * Each model is downloaded as the 1k glTF (the .bin holds the geometry; textures
 * are ignored), decimated with meshoptimizer to <= MAX_TRIS, converted to a
 * geometry-only glb in millimetres with Z up, centred with its lowest point at
 * z = 0, and listed in manifest.json with its licence and source URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Document } from '@gltf-transform/core';
import { simplify, weld, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'public', 'assets', 'packs', 'core');
const UA = 'Base-ifier/0.1 (https://github.com/BearFighter/base-ifier; CC0 prop pack builder)';
const MAX_TRIS = 30000;
/** target size on the table for the longest side, mm (the studio scales further) */
const TARGET_LONGEST_MM = { rock: 12, boulder: 22, debris: 8, log: 14, container: 8 };

/** Curated Poly Haven models that read well at 28-32 mm scale. */
const CURATED = [
  { id: 'rock_moss_set_01', family: 'rock', kind: 'rock', label: 'Mossy rock 1' },
  { id: 'rock_moss_set_02', family: 'rock', kind: 'rock', label: 'Mossy rock 2' },
  { id: 'rock_07', family: 'rock', kind: 'rock', label: 'Weathered rock' },
  { id: 'rock_09', family: 'rock', kind: 'rock', label: 'Weathered stone' },
  { id: 'stone_01', family: 'rock', kind: 'rock', label: 'Field stone' },
  { id: 'boulder_01', family: 'rock', kind: 'boulder', label: 'Lichen boulder' },
  { id: 'namaqualand_boulder_02', family: 'rock', kind: 'boulder', label: 'Desert boulder 1' },
  { id: 'namaqualand_boulder_03', family: 'rock', kind: 'boulder', label: 'Desert boulder 2' },
  { id: 'namaqualand_boulder_05', family: 'rock', kind: 'boulder', label: 'Desert boulder 3' },
  { id: 'namaqualand_rocks_01', family: 'rock', kind: 'rock', label: 'Quartz rocks' },
  { id: 'coast_rocks_05', family: 'rock', kind: 'rock', label: 'Coastal rock' },
  { id: 'sand_rocks_small_01', family: 'debris', kind: 'debris', label: 'Small sand rocks' },
  { id: 'moon_rock_01', family: 'rock', kind: 'rock', label: 'Moon rock 1' },
  { id: 'moon_rock_03', family: 'rock', kind: 'rock', label: 'Moon rock 2' },
  { id: 'moon_rock_06', family: 'rock', kind: 'boulder', label: 'Moon boulder' },
];

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function fetchBuf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function build(entry, io) {
  const files = await fetchJson(`https://api.polyhaven.com/files/${entry.id}`);
  const gltf = files.gltf?.['1k']?.gltf ?? Object.values(files.gltf ?? {})[0]?.gltf;
  if (!gltf) throw new Error(`${entry.id}: no gltf download`);
  const gltfJson = await fetchJson(gltf.url);
  // fetch only the .bin buffers, never the textures
  const base = gltf.url.slice(0, gltf.url.lastIndexOf('/') + 1);
  const resources = {};
  for (const b of gltfJson.buffers ?? []) if (b.uri) resources[b.uri] = new Uint8Array(await fetchBuf(base + b.uri));
  // strip materials/textures so the reader never tries to resolve images
  for (const m of gltfJson.meshes ?? []) for (const p of m.primitives) delete p.material;
  delete gltfJson.materials; delete gltfJson.textures; delete gltfJson.images; delete gltfJson.samplers;
  for (const m of gltfJson.meshes ?? []) for (const p of m.primitives) {
    for (const k of Object.keys(p.attributes)) if (k !== 'POSITION') delete p.attributes[k];
  }
  const doc = await io.readJSON({ json: gltfJson, resources });
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3;
  await MeshoptSimplifier.ready;
  const ratio = Math.min(1, MAX_TRIS / Math.max(1, tris));
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002, lockBorder: true }), dedup(), prune());
  // measure and rescale: glTF metres -> a table-scale prop
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, v); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); } }
  }
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const target = TARGET_LONGEST_MM[entry.kind] ?? 10;
  const scale = target / longest; // metres of model -> mm on the table
  let outTris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    const arr = pos.getArray();
    const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = (arr[i] - cx) * scale;
      arr[i + 1] = (arr[i + 1] - min[1]) * scale; // glTF Y up: floor at 0
      arr[i + 2] = (arr[i + 2] - cz) * scale;
    }
    pos.setArray(arr);
    outTris += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
  }
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(path.join(OUT, `${entry.id}.glb`), glb);
  return { id: entry.id, label: entry.label, family: entry.family, kind: entry.kind, file: `${entry.id}.glb`, tris: Math.round(outTris), sourceTris: Math.round(tris), bytes: glb.byteLength, licence: 'cc0', source: `https://polyhaven.com/a/${entry.id}`, author: 'Poly Haven', targetLongestMm: target };
}

async function main() {
  if (process.argv.includes('--list')) { console.table(CURATED); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const io = new NodeIO();
  const manifest = { pack: 'core', licence: 'cc0', sources: ['https://polyhaven.com (CC0)'], builtAt: new Date().toISOString(), assets: [] };
  for (const entry of CURATED) {
    try {
      const a = await build(entry, io);
      manifest.assets.push(a);
      console.log(`ok   ${a.id}: ${a.sourceTris} -> ${a.tris} tris, ${(a.bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.log(`skip ${entry.id}: ${err.message}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`wrote ${manifest.assets.length} assets to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
