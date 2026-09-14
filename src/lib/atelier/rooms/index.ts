import type { RoomId } from "../catalog";
import type { RoomFactory } from "../world";
import { createArcade } from "./arcade";
import { createCeiling } from "./ceiling";
import { createCouncil } from "./council";
import { createField } from "./field";
import { createFlow } from "./flow";
import { createWave } from "./wave";

export const FACTORIES: Record<RoomId, RoomFactory> = {
  field: createField,
  flow: createFlow,
  wave: createWave,
  ceiling: createCeiling,
  arcade: createArcade,
  council: createCouncil,
};
