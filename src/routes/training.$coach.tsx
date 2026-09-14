import { createFileRoute, notFound } from "@tanstack/react-router";
import { TrainingStation } from "@/components/desk/TrainingStation";
import { availableCoach } from "@/lib/desk/training";
import { pageHead } from "@/lib/desk/site";
export const Route = createFileRoute("/training/$coach")({
  beforeLoad: ({ params }) => { if (!availableCoach(params.coach)) throw notFound(); },
  head: ({ params }) => {
    const coach = availableCoach(params.coach);
    return pageHead(`/training/${params.coach}`, coach ? `${coach.name}'s training desk · Satoshi's Council` : "Coach unavailable · Satoshi's Council", coach?.lesson ?? "This coach is not available.");
  },
  component: TrainingStation,
});
