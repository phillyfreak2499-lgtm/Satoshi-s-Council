import { createFileRoute } from "@tanstack/react-router";
import { LabRoom } from "@/components/desk/LabRoom";
import { publicLabSnapshot } from "@/lib/desk/lab-public";

export const Route = createFileRoute("/lab")({
  head: () => ({
    meta: [
      { title: "The Lab · Satoshi's Council" },
      {
        name: "description",
        content: "Follow frozen paper-research specimens as they collect prospective evidence before any documented review.",
      },
    ],
  }),
  loader: () => publicLabSnapshot(),
  component: LabPage,
});

function LabPage() {
  return <LabRoom initial={Route.useLoaderData()} />;
}
