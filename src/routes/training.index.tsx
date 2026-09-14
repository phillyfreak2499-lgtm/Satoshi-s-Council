import { createFileRoute } from "@tanstack/react-router";
import { TrainingHome } from "@/components/desk/TrainingHome";
import { pageHead } from "@/lib/desk/site";
export const Route = createFileRoute("/training/")({
  head: () => pageHead("/training", "Training · Satoshi's Council", "Choose your Council coach. Explore WICK's candle structure or TAPE's order-book pressure through recorded evidence and paper practice."),
  component: TrainingHome,
});
