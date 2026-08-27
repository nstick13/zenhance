import { describe, it, expect } from "vitest";
import {
  DEFAULT_VOCABULARY,
  PRESETS,
  MAX_TERM_LENGTH,
  normalizeVocabulary,
  matchPreset,
  presetById,
  isDefaultVocabulary,
  sameVocabulary,
  lower,
  title,
  type Vocabulary,
} from "@/lib/vocabulary";

describe("normalizeVocabulary", () => {
  it("falls back to the defaults for junk", () => {
    for (const junk of [null, undefined, 0, "value stream", [], true]) {
      expect(normalizeVocabulary(junk)).toEqual(DEFAULT_VOCABULARY);
    }
  });

  it("keeps a valid rung even when the other is missing", () => {
    const v = normalizeVocabulary({ stream: { singular: "Train", plural: "Trains" } });
    expect(v.stream).toEqual({ singular: "Train", plural: "Trains" });
    expect(v.team).toEqual(DEFAULT_VOCABULARY.team);
  });

  it("derives a plural when only a singular was stored", () => {
    const v = normalizeVocabulary({ team: { singular: "Pod" } });
    expect(v.team).toEqual({ singular: "Pod", plural: "Pods" });
  });

  it("falls back per-field rather than discarding the sibling", () => {
    const v = normalizeVocabulary({ team: { singular: "   ", plural: "Pods" } });
    expect(v.team).toEqual({ singular: DEFAULT_VOCABULARY.team.singular, plural: "Pods" });
  });

  it("drops unknown keys and unknown shapes", () => {
    const v = normalizeVocabulary({
      stream: { singular: "Train", plural: "Trains", colour: "red" },
      team: 42,
      squad: { singular: "Squad", plural: "Squads" },
    });
    expect(v).toEqual({
      stream: { singular: "Train", plural: "Trains" },
      team: DEFAULT_VOCABULARY.team,
    });
    expect(Object.keys(v).sort()).toEqual(["stream", "team"]);
  });

  it("trims and caps a runaway term instead of rejecting it", () => {
    const long = "x".repeat(200);
    const v = normalizeVocabulary({ team: { singular: `  ${long}  `, plural: long } });
    expect(v.team.singular).toHaveLength(MAX_TERM_LENGTH);
    expect(v.team.plural).toHaveLength(MAX_TERM_LENGTH);
  });

  it("is idempotent — normalising a normalised blob changes nothing", () => {
    const once = normalizeVocabulary({ stream: { singular: "Vertical product group" } });
    expect(normalizeVocabulary(once)).toEqual(once);
  });

  it("never throws, whatever it is handed", () => {
    const nasty: unknown[] = [
      { stream: null },
      { stream: { singular: null, plural: [] } },
      { stream: [] },
      Object.create(null),
      new Date(),
    ];
    for (const raw of nasty) {
      expect(() => normalizeVocabulary(raw)).not.toThrow();
    }
  });
});

describe("presets", () => {
  it("has stable ids and a description apiece", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PRESETS) {
      expect(p.description.trim().length).toBeGreaterThan(20);
      expect(presetById(p.id)).toBe(p);
    }
  });

  it("every preset survives normalisation unchanged", () => {
    for (const p of PRESETS) {
      expect(normalizeVocabulary(p.vocabulary)).toEqual(p.vocabulary);
    }
  });

  it("matches a preset exactly, and reports custom otherwise", () => {
    const safe = PRESETS.find((p) => p.id === "safe")!;
    expect(matchPreset(safe.vocabulary)?.id).toBe("safe");
    const custom: Vocabulary = {
      stream: { singular: "Portfolio", plural: "Portfolios" },
      team: { singular: "Crew", plural: "Crews" },
    };
    expect(matchPreset(custom)).toBeNull();
  });

  it("carries SAFe and vertical-product-group terms Heather asked for", () => {
    expect(presetById("safe")!.vocabulary.stream.singular).toBe("Agile Release Train");
    expect(presetById("product-group")!.vocabulary.stream.singular).toBe(
      "Vertical product group",
    );
  });

  it("knows the default vocabulary", () => {
    expect(isDefaultVocabulary(DEFAULT_VOCABULARY)).toBe(true);
    expect(isDefaultVocabulary(presetById("safe")!.vocabulary)).toBe(false);
    expect(sameVocabulary(DEFAULT_VOCABULARY, { ...DEFAULT_VOCABULARY })).toBe(true);
  });
});

describe("case helpers", () => {
  it("lowercases a plain capitalised term for mid-sentence use", () => {
    expect(lower("Value stream")).toBe("value stream");
    expect(lower("Team")).toBe("team");
  });

  it("leaves a proper noun or acronym alone", () => {
    expect(lower("Agile Release Train")).toBe("Agile Release Train");
    expect(lower("ART")).toBe("ART");
  });

  it("capitalises for sentence-initial use without touching the rest", () => {
    expect(title("value stream")).toBe("Value stream");
    expect(title("Agile Release Train")).toBe("Agile Release Train");
    expect(title("")).toBe("");
  });
});
