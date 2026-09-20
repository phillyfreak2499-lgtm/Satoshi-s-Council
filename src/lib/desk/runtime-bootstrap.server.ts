/**
 * Idempotent bootstrap for the long-running Council runtime.
 *
 * Keep this module deliberately light: every subsystem is dynamically imported
 * and started fire-and-forget. Individual starters own their overlap guards.
 * Nothing here changes Chair/Floor authority.
 */
export function ensureDeskRuntime(): void {
  void import("./server-engine")
    .then((m) => m.ensureServerEngine())
    .catch(() => {});
  void import("./chair-v3-prospective.server")
    .then((m) => m.ensureChairV3ProspectiveObserver())
    .catch(() => {});
  void import("./call-quality.server")
    .then((m) => m.ensureCallQualityObserver())
    .catch(() => {});
  void import("./forced-v4.server")
    .then((m) => m.ensureForcedV4Observer())
    .catch(() => {});
  void import("./openai-shadow.server")
    .then((m) => m.ensureOpenAIShadowObserver())
    .catch(() => {});
  void import("./openai-blind.server")
    .then((m) => m.ensureOpenAIBlindObserver())
    .catch(() => {});
  void import("./openai-luna.server")
    .then((m) => m.ensureOpenAILunaObserver())
    .catch(() => {});
  void import("./chair-ablation.server")
    .then((m) => m.ensureChairAblationObserver())
    .catch(() => {});
  void import("./lab-registry.server")
    .then((m) => m.ensureLabRegistryObserver())
    .catch(() => {});
  void import("./astra-director.server")
    .then((m) => m.ensureAstraDirectorObserver())
    .catch(() => {});
  void import("./hour-closer.server")
    .then((m) => m.ensureHourCloser())
    .catch(() => {});
}
