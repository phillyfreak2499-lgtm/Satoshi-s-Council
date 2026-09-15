import type { RoomId } from "../catalog";
import type { RoomFactory } from "../world";
import { createArcade } from "./arcade";
import { createCeiling } from "./ceiling";
import { createCouncil } from "./council";
import { createField } from "./field";
import { createFlow } from "./flow";
import { createForge } from "./forge";
import { createWave } from "./wave";

export const FACTORIES: Record<Exclude<RoomId, "streamer">, RoomFactory> = {
  field: createField,
  flow: createFlow,
  wave: createWave,
  ceiling: createCeiling,
  arcade: createArcade,
  council: createCouncil,
  forge: createForge,
};
