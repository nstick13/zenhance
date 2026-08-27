import { getPeople, getDisciplines, getVocabulary } from "@/lib/data/queries";
import { lower } from "@/lib/vocabulary";
import { PeopleManager } from "@/components/people/PeopleManager";

export default async function PeoplePage() {
  const [people, disciplines, vocabulary] = await Promise.all([
    getPeople(),
    getDisciplines(),
    getVocabulary(),
  ]);
  return (
    <div className="min-h-[calc(100vh-57px)] bg-paper text-ink">
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-semibold">People</h1>
            <p className="text-sm text-ink-soft">
              Everyone in your delivery org. Assign them to{" "}
              {lower(vocabulary.team.plural)} on the {vocabulary.team.plural} page.
            </p>
          </div>
        </div>
        <PeopleManager initialPeople={people} disciplines={disciplines} />
      </div>
    </div>
  );
}
