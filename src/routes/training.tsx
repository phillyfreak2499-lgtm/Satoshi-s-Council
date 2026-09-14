import { createFileRoute, Outlet } from "@tanstack/react-router";
import { GlobalHeader } from "@/components/desk/GlobalHeader";
export const Route = createFileRoute("/training")({ component: TrainingLayout });
function TrainingLayout() {
  return <div className="min-h-dvh bg-bg text-fg"><a href="#training-main" className="skip-link">Skip to training</a><GlobalHeader /><Outlet /></div>;
}
