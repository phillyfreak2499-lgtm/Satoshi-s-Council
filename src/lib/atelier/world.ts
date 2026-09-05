import type { Params, RoomId } from "./catalog";

export type PointerKind = "down" | "move" | "up";

export type RoomWorld = {
  resize(w: number, h: number): void;
  reseed(seed: number): void;
  setParams(p: Params): void;
  pointer(x: number, y: number, kind: PointerKind): void;
  step(dt: number, t: number): void;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
};

export type RoomHost = {
  setParam(key: string, value: string | number): void;
};

export type RoomFactory = (
  w: number,
  h: number,
  seed: number,
  params: Params,
  host: RoomHost,
) => RoomWorld;

export type { Params, RoomId };
