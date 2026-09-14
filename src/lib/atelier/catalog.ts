export type RoomId = "field" | "flow" | "wave" | "ceiling" | "arcade" | "council";

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
    word: "Veil",
    name: "Signal Veil",
    glow: "#d4a02a",
    meta: "Call-reactive light · one edition per window",
    fine: "A living field made from SATOSHI's current paper call. UP, DOWN, and WAIT each keep their own climate; the composition changes with every 15-minute window.",
    hint: "The climate follows SATOSHI only. The orbit is the open paper window.",
    params: [
      { key: "bloom", kind: "range", label: "Bloom", min: 0.5, max: 1.8, step: 0.05, def: 1, format: fmt },
      { key: "grain", kind: "range", label: "Grain", min: 0, max: 1, step: 0.05, def: 0.22, format: fmt },
    ],
  },
  {
    id: "flow",
    index: "02",
    word: "Current",
    name: "Signal Current",
    glow: "#d4a02a",
    meta: "Noise advection · live call palette",
    fine: "A field of particles follows a changing noise lattice. The current inherits only the live SATOSHI call palette; dragging the work bends its flow.",
    hint: "Drag to warp the current. Scale changes the weather; curl makes it loop.",
    params: [
      { key: "scale", kind: "range", label: "Scale", min: 0.0015, max: 0.012, step: 0.0005, def: 0.004, format: fmt },
      { key: "speed", kind: "range", label: "Speed", min: 0.2, max: 2.2, step: 0.05, def: 1.35, format: fmt },
      { key: "curl", kind: "range", label: "Curl", min: 0, max: 1.6, step: 0.05, def: 0.35, format: fmt },
    ],
  },
  {
    id: "wave",
    index: "03",
    word: "Echo",
    name: "Interference Echo",
    glow: "#d4a02a",
    meta: "Radial sines · live call palette",
    fine: "Each source writes a wave of distance. Where crests meet, light. The palette follows SATOSHI; tapping the work adds another voice to the field.",
    hint: "Tap to drop a source. Wavelength is the stripe; speed is the tide.",
    params: [
      { key: "wave", kind: "range", label: "Length", min: 12, max: 70, step: 1, def: 28, format: fmt },
      { key: "speed", kind: "range", label: "Speed", min: 0.2, max: 2.4, step: 0.05, def: 1.4, format: fmt },
      { key: "contrast", kind: "range", label: "Ink", min: 0.4, max: 1.6, step: 0.05, def: 1, format: fmt },
    ],
  },
  {
    id: "ceiling",
    index: "04",
    word: "Ceiling",
    name: "Cloud Ceiling",
    glow: "#f7931a",
    meta: "Live BTC vs strike · final-minute BRTI average",
    fine: "A night-flight view of the live Bitcoin print against the locked strike. In Final Approach, the translucent settlement ghost follows the BRTI prints already observed in the 60-second average.",
    hint: "The live plane can cross the deck and still lose. In the final minute, the settlement ghost is the aircraft that matters.",
    params: [
      { key: "clouds", kind: "range", label: "Clouds", min: 0.55, max: 1.45, step: 0.05, def: 1, format: fmt },
      { key: "trail", kind: "range", label: "Contrail", min: 0.6, max: 1.6, step: 0.05, def: 1, format: fmt },
    ],
  },
  {
    id: "arcade",
    index: "05",
    word: "Arcade",
    name: "Tape Arcade",
    glow: "#f7931a",
    meta: "Live tape road · steerable paper cabinet",
    fine: "The Bitcoin print pours the road in real time. Watch as a passenger or touch the cabinet to drive. GRIP scores the hands; the contract result stays separate and follows the BRTI settlement average.",
    hint: "Drag vertically to steer. Winning the drive is not winning the contract. GRIP is skill; settlement is weather.",
    params: [
      {
        key: "mode",
        kind: "enum",
        label: "Mode",
        options: [
          { value: "watch", label: "Watch" },
          { value: "drive", label: "Drive" },
        ],
        def: "watch",
      },
      {
        key: "assist",
        kind: "enum",
        label: "Assist magnet",
        options: [
          { value: "on", label: "On" },
          { value: "off", label: "Expert off" },
        ],
        def: "on",
      },
      { key: "cabinet", kind: "range", label: "Cabinet glow", min: 0.6, max: 1.5, step: 0.05, def: 1, format: fmt },
    ],
  },
  {
    id: "council",
    index: "06",
    word: "Council",
    name: "Council Constellation",
    glow: "#d4a02a",
    meta: "18-seat star map · live agreement and dissent",
    fine: "The specialist seats become a live constellation around the Chair. Speaking UP and DOWN seats flare in their own hemispheres; WAIT stays dim and amber. The horizon ring is score versus bar, never win probability.",
    hint: "Every star is one seat. Brightness is confidence; color is the spoken paper lean; the center is the Chair.",
    params: [
      { key: "orbit", kind: "range", label: "Orbit", min: 0.7, max: 1.3, step: 0.05, def: 1, format: fmt },
      { key: "trails", kind: "range", label: "Connections", min: 0.25, max: 1.35, step: 0.05, def: 0.85, format: fmt },
    ],
  },
];

export function roomById(id: RoomId): RoomMeta {
  return ROOMS.find((room) => room.id === id) ?? ROOMS[0]!;
}

export function defaultParams(room: RoomMeta): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const param of room.params) out[param.key] = param.def;
  return out;
}

export type Params = Record<string, string | number>;

export function num(params: Params, key: string, fallback: number) {
  const value = params[key];
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function str(params: Params, key: string, fallback: string) {
  const value = params[key];
  return typeof value === "string" ? value : fallback;
}
