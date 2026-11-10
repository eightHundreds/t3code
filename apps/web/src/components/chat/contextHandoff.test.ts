import { describe, expect, it } from "vite-plus/test";

import {
  contextRatio,
  expectedHandoffFileName,
  expectedHandoffPath,
  hasHandoffBudgetFailure,
  longConversationLevel,
  parseHandoffPath,
} from "./contextHandoff";

describe("context handoff", () => {
  it("parses a plain final path, and a decorated path only after a request", () => {
    expect(parseHandoffPath("done\nHANDOFF: /repo/HANDOFF-abc.md", { strict: true })).toBe(
      "/repo/HANDOFF-abc.md",
    );
    expect(
      parseHandoffPath("See HANDOFF: /repo/HANDOFF-abc.md in the notes", { strict: true }),
    ).toBe(null);
    expect(parseHandoffPath("**HANDOFF:** `/repo/HANDOFF-abc.md`（已写好）")).toBe(
      "/repo/HANDOFF-abc.md",
    );
    expect(parseHandoffPath("HANDOFF: C:\\repo\\HANDOFF-abc.md")).toBe("C:\\repo\\HANDOFF-abc.md");
  });

  it("fixes the handoff file name from the thread and the day", () => {
    const date = new Date(2026, 10, 9);
    expect(expectedHandoffFileName("thread-1234", date)).toBe("HANDOFF-thread-1-20261109.md");
    expect(expectedHandoffPath("/work/repo/", "thread-1234", date)).toBe(
      "/work/repo/HANDOFF-thread-1-20261109.md",
    );
  });

  it("flags a long session and a window that is almost full", () => {
    expect(
      longConversationLevel({
        relationshipToParent: null,
        items: 1,
        turns: 1,
        ratio: 0.61,
        usedTokens: 1,
      }),
    ).toBe("reminder");
    expect(
      longConversationLevel({
        relationshipToParent: "subagent",
        items: 2_000,
        turns: 80,
        ratio: 0.99,
        usedTokens: 300_000,
      }),
    ).toBeNull();
    expect(
      longConversationLevel({
        relationshipToParent: null,
        items: 1,
        turns: 1,
        ratio: 0.95,
        usedTokens: 1,
      }),
    ).toBe("strong");
    expect(contextRatio({ usedTokens: 0, maxTokens: 100 })).toBe(0);
    expect(contextRatio({ usedTokens: 10, maxTokens: null })).toBeNull();
  });

  it("reads a context budget failure from the latest run only", () => {
    const older = { id: "run-1", ordinal: 1, status: "failed" as const };
    const latest = { id: "run-2", ordinal: 2, status: "failed" as const };
    const failure = {
      type: "error" as const,
      runId: "run-2",
      failure: {
        code: "context_handoff_budget_exceeded",
        message: "The window is full.",
      },
    };
    expect(hasHandoffBudgetFailure({ runs: [older, latest], turnItems: [failure] })).toBe(true);
    expect(
      hasHandoffBudgetFailure({
        runs: [{ ...latest, status: "completed" }],
        turnItems: [failure],
      }),
    ).toBe(false);
    expect(
      hasHandoffBudgetFailure({
        runs: [latest],
        turnItems: [
          {
            ...failure,
            failure: {
              code: null,
              message: "Insufficient context allowance for the provider handoff. Retry later.",
            },
          },
        ],
      }),
    ).toBe(true);
  });
});
