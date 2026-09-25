import { describe, expect, it } from "vitest";
import { isLocalDatabase, isProduction, labPagesVisible, stage } from "../env";

const on = (vars: Record<string, string | undefined>) => vars as NodeJS.ProcessEnv;
const vercel = (env: string, ref?: string) =>
  on({ VERCEL_ENV: env, VERCEL_GIT_COMMIT_REF: ref });

describe("which stage are we in", () => {
  it("is production when Vercel says so, whatever the branch is called", () => {
    // Never inferred from a branch name. A name is easy to get wrong and this
    // decides who sees what.
    expect(stage(vercel("production", "main"))).toBe("production");
    expect(stage(vercel("production", "some-odd-branch"))).toBe("production");
  });

  it("reads the branch for previews", () => {
    expect(stage(vercel("preview", "lab"))).toBe("lab");
    expect(stage(vercel("preview", "next"))).toBe("next");
    expect(stage(vercel("preview", "release"))).toBe("release");
  });

  it("treats an unknown branch's preview as next — safe to look at, not to trust", () => {
    expect(stage(vercel("preview", "camera-engine"))).toBe("next");
    expect(stage(vercel("preview", undefined))).toBe("next");
  });

  it("is local when Vercel is not involved", () => {
    expect(stage(on({}))).toBe("local");
    expect(stage(on({ VERCEL_ENV: "development" }))).toBe("local");
  });

  it("never calls a preview production, even on main", () => {
    // A preview built from main is production-*shaped*, not live. Calling it
    // production would hide the lab pages on a URL nobody is meant to trust,
    // and switch on behaviour that belongs only to the real thing.
    expect(isProduction(vercel("preview", "main"))).toBe(false);
    expect(stage(vercel("preview", "main"))).toBe("release");
  });
});

describe("the lab pages", () => {
  it("are reachable everywhere except production", () => {
    expect(labPagesVisible(on({}))).toBe(true);
    expect(labPagesVisible(vercel("preview", "lab"))).toBe(true);
    expect(labPagesVisible(vercel("preview", "next"))).toBe(true);
    expect(labPagesVisible(vercel("preview", "release"))).toBe(true);
  });

  it("are gone in production, so a customer cannot find one by guessing", () => {
    expect(labPagesVisible(vercel("production", "main"))).toBe(false);
  });

  it("are gone in production even if the branch is named lab", () => {
    expect(labPagesVisible(vercel("production", "lab"))).toBe(false);
  });
});

describe("is this database mine", () => {
  it("recognises this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(isLocalDatabase(`postgresql://${host}:5432/zenhance`)).toBe(true);
    }
  });

  it("refuses anything hosted", () => {
    expect(isLocalDatabase("postgresql://ep-aged-flower.neon.tech/zenhance")).toBe(false);
    expect(isLocalDatabase("postgresql://db.example.com:5432/zenhance")).toBe(false);
  });

  it("refuses a host that merely mentions localhost", () => {
    // "localhost.evil.com" is not this machine.
    expect(isLocalDatabase("postgresql://localhost.example.com:5432/x")).toBe(false);
  });

  it("refuses what it cannot read, rather than assuming the best", () => {
    expect(isLocalDatabase(undefined)).toBe(false);
    expect(isLocalDatabase("")).toBe(false);
    expect(isLocalDatabase("not a url")).toBe(false);
  });
});
