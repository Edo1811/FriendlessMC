// The screenshot renderer (prismarine-viewer) only knows block data up to 1.21.4. Newer servers
// use different block state ids, so chunks are translated before they're sent to it: only the
// palettes (the list of block states a chunk section uses) are rewritten, not every block.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const prismarineBlock = require('prismarine-block');
const BitArray = require('prismarine-chunk/src/pc/common/BitArrayNoSpan');

// Blocks added after the renderer's version get the closest older look.
const STAND_INS = [
  [/leaf_litter|wildflowers|bush|dry_grass|cactus_flower/, 'air'],
  [/copper.*(bars|chain)/, 'iron_bars'],
  [/copper.*(lantern)/, 'lantern'],
  [/copper.*(torch)/, 'torch'],
  [/copper_(chest|golem)/, 'chest'],
  [/shelf/, 'bookshelf'],
  [/dried_ghast/, 'soul_sand'],
  [/copper/, 'copper_block'],
  [/glass/, 'glass'],
  [/_log|_wood/, 'oak_log'],
  [/_planks/, 'oak_planks'],
  [/./, 'stone'],
];

export function createStateTranslator(fromVersion, toVersion) {
  if (fromVersion === toVersion) return (stateId) => stateId;
  const From = prismarineBlock(fromVersion);
  const To = prismarineBlock(toVersion);
  const cache = new Map();

  const toState = (name, props) => {
    try {
      return To.fromProperties(name, props, 0).stateId;
    } catch {
      return undefined;
    }
  };

  return (stateId) => {
    let mapped = cache.get(stateId);
    if (mapped !== undefined) return mapped;
    const block = From.fromStateId(stateId, 0);
    const props = block.getProperties();
    mapped = toState(block.name, props) ?? toState(block.name, {});
    if (mapped === undefined) {
      const standIn = STAND_INS.find(([pattern]) => pattern.test(block.name))[1];
      mapped = toState(standIn, {}) ?? 0;
    }
    cache.set(stateId, mapped);
    return mapped;
  };
}

// "direct" containers (sections with more than 256 different block states) are rewritten as
// palette ("indirect") containers: prismarine-chunk's fromJson loses a direct container's data,
// so the renderer would show those sections as air.
function translateContainer(json, translate) {
  const c = JSON.parse(json);
  if (c.type === 'single') c.value = translate(c.value);
  else if (c.type === 'indirect') c.palette = c.palette.map(translate);
  else if (c.type === 'direct') {
    const source = BitArray.fromJson(c.data);
    const palette = [];
    const indexOf = new Map();
    const indexes = new Array(source.capacity);
    for (let i = 0; i < source.capacity; i++) {
      const state = translate(source.get(i));
      let idx = indexOf.get(state);
      if (idx === undefined) {
        idx = palette.push(state) - 1;
        indexOf.set(state, idx);
      }
      indexes[i] = idx;
    }
    const bits = Math.max(4, Math.ceil(Math.log2(palette.length)));
    return JSON.stringify({
      type: 'indirect',
      palette,
      maxBits: Math.max(8, bits),
      maxBitsPerBlock: 15,
      data: BitArray.fromArray(indexes, bits).toJson(),
    });
  }
  return JSON.stringify(c);
}

// Rewrites a ChunkColumn.toJson() string so the renderer's prismarine-chunk reads the right blocks.
export function translateChunkJson(chunkJson, translate) {
  const column = JSON.parse(chunkJson);
  column.sections = column.sections.map((sectionJson) => {
    const section = JSON.parse(sectionJson);
    section.data = translateContainer(section.data, translate);
    return JSON.stringify(section);
  });
  return JSON.stringify(column);
}
