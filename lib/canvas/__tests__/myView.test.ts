import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  readMyView,
  writeMyView,
  clearMyView,
  sameLens,
  resolveOpeningLens,
} from "../myView";
import { DEFAULT_LENS, type Lens } from "../lens";

/** A minimal localStorage, so these run without a DOM environment. */
function installStorage(impl?: Partial<Storage>) {
  const map = new Map<string, string>();
  const store: Storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    ...impl,
  } as Storage;
  vi.stubGlobal("window", { localStorage: store });
  return map;
}

const WS = "ws-1";
const DISCIPLINE: Lens = { colorBy: "discipline", labelBy: "name" };
const STREAM: Lens = { colorBy: "stream", labelBy: "initials" };

describe("my view storage", () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips a lens", () => {
    writeMyView(WS, DISCIPLINE);
    expect(readMyView(WS)).toEqual(DISCIPLINE);
  });

  it("keeps each workspace's view separate", () => {
    writeMyView(WS, DISCIPLINE);
    writeMyView("ws-2", STREAM);
    expect(readMyView(WS)).toEqual(DISCIPLINE);
    expect(readMyView("ws-2")).toEqual(STREAM);
  });

  it("returns null when nothing is stored", () => {
    expect(readMyView(WS)).toBeNull();
  });

  it("clears an override", () => {
    writeMyView(WS, DISCIPLINE);
    clearMyView(WS);
    expect(readMyView(WS)).toBeNull();
  });

  it("normalises a stored blob rather than trusting it", () => {
    // A build that wrote a field this build doesn't understand, plus one it does.
    installStorage().set(
      "zenhance:lens:ws-1",
      JSON.stringify({ colorBy: "discipline", labelBy: "wat", future: "x" }),
    );
    const v = readMyView(WS)!;
    expect(v.colorBy).toBe("discipline");
    expect(v.labelBy).toBe(DEFAULT_LENS.labelBy); // degraded per field, not dropped whole
  });

  it("survives unparsable storage instead of crashing the map", () => {
    installStorage().set("zenhance:lens:ws-1", "{not json");
    expect(readMyView(WS)).toBeNull();
  });

  it("survives storage that throws (private windows, blocked site data)", () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(readMyView(WS)).toBeNull();
    expect(() => writeMyView(WS, DISCIPLINE)).not.toThrow();
    expect(() => clearMyView(WS)).not.toThrow();
  });

  it("ignores an empty workspace id rather than writing a shared key", () => {
    const map = installStorage();
    writeMyView("", DISCIPLINE);
    expect(map.size).toBe(0);
    expect(readMyView("")).toBeNull();
  });
});

describe("sameLens", () => {
  it("compares field-wise, not by reference", () => {
    expect(sameLens({ ...DISCIPLINE }, { ...DISCIPLINE })).toBe(true);
    expect(sameLens(DISCIPLINE, STREAM)).toBe(false);
    expect(
      sameLens(DISCIPLINE, { colorBy: "discipline", labelBy: "initials" }),
    ).toBe(false);
  });
});

describe("resolveOpeningLens", () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it("opens on the workspace default when I have no view", () => {
    expect(resolveOpeningLens(WS, DISCIPLINE)).toEqual({
      lens: DISCIPLINE,
      isMine: false,
    });
  });

  it("opens on my view when I have one", () => {
    writeMyView(WS, STREAM);
    expect(resolveOpeningLens(WS, DISCIPLINE)).toEqual({
      lens: STREAM,
      isMine: true,
    });
  });

  it("does not report 'just for me' when my view matches the default", () => {
    // Otherwise the amber dot sticks on forever after the workspace default
    // catches up with what someone had already chosen for themselves.
    writeMyView(WS, DISCIPLINE);
    expect(resolveOpeningLens(WS, DISCIPLINE)).toEqual({
      lens: DISCIPLINE,
      isMine: false,
    });
  });

  it("never lets a broken override hide the workspace default", () => {
    installStorage().set("zenhance:lens:ws-1", "garbage");
    expect(resolveOpeningLens(WS, DISCIPLINE)).toEqual({
      lens: DISCIPLINE,
      isMine: false,
    });
  });
});
