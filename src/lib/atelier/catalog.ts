export type RoomId = "field" | "flow" | "wave";

export type EnumParam = {
  key: string;
  kind: "enum";
  label: string;
  options: { value: string; label: string }[];
  def: string;
};

export type RangeParam = {
  key: string;
  kind: "range";
  label: string;
  min: number;
  max: number;
  step: number;
  def: number;
  format?: (n: number) => string;
};

export type ParamDef = EnumParam | RangeParam;

export type RoomMeta = {
  id: RoomId;
  index: string;
  word: string;
  name: string;
  glow: string;
  meta: string;
  fine: string;
  hint: string;
  params: ParamDef[];
};

const fmt = (n: number) => {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(Math.abs(n) < 0.01 ? 4 : 2);
  return s.replace(/0+$/, "").replace(/\.$/, "");
};

export const ROOMS: RoomMeta[] = [
  {
    id: "field",
    index: "01",
    word: "Field",
    name: "Color Field",
    glow: "#c43a2a",
    meta: "Rothko veils · SATOSHI 15m paper",
    fine: "A picture of SATOSHI's paper call. Not a recommendation to buy, sell, or hold any asset.",
    hint: "Colors follow SATOSHI only — Down, Wait, or Up. The ring is the open window.",
    params: [
      { key: "bloom", kind: "range", label: "Bloom", min: 0.5, max: 1.8, step: 0.05, def: 1, format: fmt },
      { key: "grain", kind: "range", label: "Grain", min: 0, max: 1, step: 0.05, def: 0.28, format: fmt },
    ],
  },
  {
    id: "flow",
    index: "02",
    word: "Flow",
    name: "Flow Field",
    glow: "#d4a02a",
    meta: "Perlin advection · particle trails",
    fine: "A noise lattice is read as an angle at every point. Particles take a tiny step along those arrows. The trails are the integral of the field.",
    hint: "Drag to warp the field. Scale changes the weather, curl makes it loop.",
    params: [
      { key: "scale", kind: "range", label: "Scale", min: 0.0015, max: 0.012, step: 0.0005, def: 0.004, format: fmt },
      { key: "speed", kind: "range", label: "Speed", min: 0.2, max: 2.2, step: 0.05, def: 1.35, format: fmt },
      { key: "curl", kind: "range", label: "Curl", min: 0, max: 1.6, step: 0.05, def: 0.35, format: fmt },
    ],
  },
  {
    id: "wave",
    index: "03",
    word: "Wave",
    name: "Interference",
    glow: "#3ad056",
    meta: "Radial sines · superposition",
    fine: "Each source writes a sine of distance. Where crests meet, light. The whole picture is one sum. Superposition is the only trick.",
    hint: "Tap to drop a source. Wavelength is the stripe; speed is the tide.",
    params: [
      { key: "wave", kind: "range", label: "Length", min: 12, max: 70, step: 1, def: 28, format: fmt },
      { key: "speed", kind: "range", label: "Speed", min: 0.2, max: 2.4, step: 0.05, def: 1.4, format: fmt },
      { key: "contrast", kind: "range", label: "Ink", min: 0.4, max: 1.6, step: 0.05, def: 1, format: fmt },
    ],
  },
];

export function roomById(id: RoomId): RoomMeta {
  return ROOMS.find((r) => r.id === id) ?? ROOMS[0]!;
}

export function defaultParams(room: RoomMeta): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const p of room.params) out[p.key] = p.def;
  return out;
}

export type Params = Record<string, string | number>;

export function num(params: Params, key: string, fallback: number) {
  const v = params[key];
  if (typeof v === "number") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function str(params: Params, key: string, fallback: string) {
  const v = params[key];
  return typeof v === "string" ? v : fallback;
}
