import { getOrgSnapshot } from "@/lib/data/queries";
import { TeamsManager } from "@/components/teams/TeamsManager";
import { lower } from "@/lib/vocabulary";

export default async function TeamsPage() {
  const snapshot = await getOrgSnapshot();
  const { vocabulary: v } = snapshot;
  return (
    <div className="min-h-[calc(100vh-57px)] bg-paper text-ink">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{v.team.plural} &amp; structure</h1>
          <p className="text-sm text-ink-soft">
            Build the delivery tree: {lower(v.stream.plural)} contain{" "}
            {lower(v.team.plural)}, {lower(v.team.plural)} contain people. Assign
            members, mark leads, and flag open roles.
          </p>
        </div>
        <TeamsManager
          units={snapshot.units}
          people={snapshot.people}
          assignments={snapshot.assignments}
          vocabulary={v}
        />
      </div>
    </div>
  );
}
