/**
 * **What a double-click offers**, and nothing else — the companion to
 * `questions.ts`, which holds what *holding one node over another* offers.
 *
 * Greg, 2026-10-19: *"I think the next model needs a double-click thing, and
 * depending on what you click, you get options."* There are two *what you
 * clicked*s, and they ask different questions:
 *
 *  - **Ground** — open paper, or the grey a unit keeps around itself. The
 *    question is what to make, and `ground.ts` has already answered who it
 *    would belong to.
 *  - **A node** — the question is about that node.
 *
 * ## The wording is relational, not ranked
 *
 * Greg's first words for the menu were *"a new node or human of any level"*.
 * Level is the part that does not survive contact with this map: the engine
 * knows a **person** and a **place**, and how deep something sits is a
 * consequence of who it reports to, not a property anybody chooses. A menu
 * offering *"division"* would be inventing a vocabulary the model does not
 * have, and then having to keep it true.
 *
 * So each item says what the new thing would be **to the place you clicked** —
 * *a person in Dune Team*, *a team in Dune Team*, *something on its own*. It
 * is the grow study's own lesson said in a menu: a team is discovered from
 * where you act, not declared from a list.
 *
 * ## Why a node menu exists at all
 *
 * **"Something above it" is the one creation that cannot be done by
 * pointing.** A child goes in a cell, and you can point at the cell. A parent
 * is a rung — there is no cell that means *above* — so without this menu there
 * is no gesture for it at all.
 */

/** What the item does. Which *parent* `where` means is the lab's business. */
export type MenuAction =
  | { do: "make"; kind: "person" | "place"; where: "holder" | "island" }
  /** Open the wizard — only for a node made here, which knows what it still
   *  needs to be told. */
  | { do: "describe" }
  /** A node the company came with: the only thing left to say is its name. */
  | { do: "rename" }
  | { do: "under" }
  | { do: "above" }
  | { do: "remove" };

export type MenuItem = {
  label: string;
  action: MenuAction;
  /** Drawn apart, and in red. */
  danger?: boolean;
};

export type Spot =
  | {
      kind: "make";
      /** Whose ground it is, from `holderOf`, or null on open paper. */
      holder: string | null;
    }
  | {
      kind: "node";
      unitId: string;
      /** The company itself has no parent to put anything above, and removing
       *  it would remove everything. */
      isRoot: boolean;
      /** Made on this page, so it has a wizard of its own. */
      isBorn: boolean;
      /** False when there is nowhere free to put a child, so the item is not
       *  offered rather than offered and then failing. */
      hasRoom: boolean;
    };

/**
 * Three items at most, so the menu is read rather than scanned. Greg,
 * 2026-10-20: *"the gesture will eventually bring up a short menu… and
 * potentially provide wider options via a menu elsewhere."* Wider options go
 * elsewhere; this stays short.
 */
export function menuFor(spot: Spot, nameOf: (id: string) => string): MenuItem[] {
  if (spot.kind === "make") {
    const inside = spot.holder ? nameOf(spot.holder) : null;
    const items: MenuItem[] = [
      {
        label: inside ? `A person in ${inside}` : "A person",
        action: { do: "make", kind: "person", where: inside ? "holder" : "island" },
      },
      {
        label: inside ? `A team in ${inside}` : "A team",
        action: { do: "make", kind: "place", where: inside ? "holder" : "island" },
      },
    ];
    // Only worth offering where there is something to be apart from. On open
    // paper every new thing is already on its own.
    if (inside) {
      items.push({ label: "Something on its own", action: { do: "make", kind: "place", where: "island" } });
    }
    return items;
  }

  const name = nameOf(spot.unitId);
  const items: MenuItem[] = [
    { label: `Describe ${name}…`, action: spot.isBorn ? { do: "describe" } : { do: "rename" } },
  ];
  if (spot.hasRoom) items.push({ label: `Someone under ${name}`, action: { do: "under" } });
  if (!spot.isRoot) {
    items.push({ label: `Something above ${name}`, action: { do: "above" } });
    items.push({ label: `Remove ${name}`, action: { do: "remove" }, danger: true });
  }
  return items;
}
