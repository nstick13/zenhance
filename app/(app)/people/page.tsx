import { getPeople, getDisciplines } from "@/lib/data/queries";
import { PeopleManager } from "@/components/people/PeopleManager";

export default async function PeoplePage() {
  const [people, disciplines] = await Promise.all([getPeople(), getDisciplines()]);
  return (
    <div className="min-h-[calc(100vh-57px)] bg-paper text-ink">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">People</h1>
            <p className="text-sm text-ink-soft">
              Everyone in your delivery org. Assign them to teams on the Teams page.
            </p>
          </div>
        </div>
        <PeopleManager initialPeople={people} disciplines={disciplines} />
      </div>
    </div>
  );
}
