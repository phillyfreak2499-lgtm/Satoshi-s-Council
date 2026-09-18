import { createFileRoute } from "@tanstack/react-router";
import { TrainingHome } from "@/components/desk/TrainingHome";
import { pageHead } from "@/lib/desk/site";
export const Route = createFileRoute("/training/")({
  head: () => pageHead("/training", "Training · Satoshi's Council", "Start with WICK. Learn to read a closed candle and decide when to wait. Paper only. No live orders."),
  component: TrainingHome,
});
