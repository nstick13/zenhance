/** One deterministic, illustrative face palette for both map renderers. */
const BACKGROUNDS = ["#d9f5fb", "#e8e2ff", "#dfeaff", "#d9f0ff", "#eae8ff"];
const SHIRTS = ["#626ce2", "#875ee2", "#329bc9", "#4d76c9", "#6559b4"];
const SKINS = ["#efc6aa", "#d69b78", "#a9674f", "#f4d5bd", "#be8265"];
const HAIR = ["#2e335a", "#543e4d", "#242c40", "#795440", "#36446a"];

function hash(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return value >>> 0;
}

export function avatarPalette(id: string) {
  const seed = hash(id);
  return {
    background: BACKGROUNDS[seed % BACKGROUNDS.length],
    shirt: SHIRTS[(seed >>> 4) % SHIRTS.length],
    skin: SKINS[(seed >>> 8) % SKINS.length],
    hair: HAIR[(seed >>> 12) % HAIR.length],
  };
}
