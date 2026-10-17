// Compares Minecraft release versions like "1.21.4", "1.21.11" or "26.1".
// Returns <0 if a is older, 0 if equal, >0 if a is newer.
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isRelease(version) {
  return /^\d+(\.\d+){1,2}$/.test(version);
}

// Builds the version chooser list: only versions both Paper and Mineflayer support,
// newest first, each tagged with how it relates to the world's version.
export function buildVersionChoices(paperVersions, mineflayerVersions, worldVersion) {
  const supported = new Set(mineflayerVersions);
  return paperVersions
    .filter((v) => isRelease(v) && supported.has(v))
    .sort((a, b) => compareVersions(b, a))
    .map((version) => {
      if (!worldVersion || !isRelease(worldVersion)) {
        return { version, relation: 'unknown', allowed: true, selected: false };
      }
      const cmp = compareVersions(version, worldVersion);
      if (cmp === 0) return { version, relation: 'same', allowed: true, selected: true };
      if (cmp > 0) return { version, relation: 'newer', allowed: true, selected: false };
      return { version, relation: 'older', allowed: false, selected: false };
    });
}
