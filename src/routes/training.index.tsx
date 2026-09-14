import { createFileRoute } from "@tanstack/react-router";
import { TrainingHome } from "@/components/desk/TrainingHome";
import { pageHead } from "@/lib/desk/site";
export const Route = createFileRoute("/training/")({
  head: () => pageHead("/training", "Training · Satoshi's Council", "Choose your Council coach. Start with WICK's six-screen desk to explore closed candles, recorded evidence, and paper practice."),
  component: TrainingHome,
});
