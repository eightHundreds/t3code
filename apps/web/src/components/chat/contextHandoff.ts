/** A budget rejection happens before the provider runs. Only the latest run counts. */
export function hasHandoffBudgetFailure(projection: {
  readonly runs: ReadonlyArray<{
    readonly id: string;
    readonly ordinal: number;
    readonly status: string;
  }>;
  readonly turnItems: ReadonlyArray<{
    readonly type: string;
    readonly runId?: string | null;
    readonly failure?:
      | string
      | {
          readonly code?: string | null;
          readonly message?: string;
        }
      | undefined;
  }>;
}): boolean {
  const latest = projection.runs.reduce<(typeof projection.runs)[number] | undefined>(
    (previous, run) => (!previous || run.ordinal > previous.ordinal ? run : previous),
    undefined,
  );
  return (
    latest?.status === "failed" &&
    projection.turnItems.some((item) => {
      const failure = item.failure;
      return (
        item.type === "error" &&
        item.runId === latest.id &&
        typeof failure === "object" &&
        failure !== null &&
        (failure.code === "context_handoff_budget_exceeded" ||
          (failure.message?.startsWith(
            "Insufficient context allowance for the provider handoff.",
          ) ??
            false))
      );
    })
  );
}

const LONG_CONVERSATION_THRESHOLDS = {
  reminder: { contextRatio: 0.6, tokens: 150_000, items: 800, turns: 30 },
  strong: { contextRatio: 0.8, tokens: 250_000, items: 1500, turns: 50 },
} as const;

export function contextRatio(
  usage: { usedTokens: number; maxTokens?: number | null | undefined } | null,
): number | null {
  return usage !== null &&
    Number.isFinite(usage.usedTokens) &&
    usage.usedTokens >= 0 &&
    usage.maxTokens != null &&
    Number.isFinite(usage.maxTokens) &&
    usage.maxTokens > 0
    ? usage.usedTokens / usage.maxTokens
    : null;
}

export function longConversationLevel(input: {
  relationshipToParent: string | null;
  items: number;
  turns: number;
  ratio: number | null;
  usedTokens?: number | null;
}): "reminder" | "strong" | null {
  if (input.relationshipToParent === "subagent") return null;
  if (input.ratio !== null && input.ratio >= 0.95) return "strong";
  for (const level of ["strong", "reminder"] as const) {
    const threshold = LONG_CONVERSATION_THRESHOLDS[level];
    if (
      (input.ratio !== null && input.ratio >= threshold.contextRatio) ||
      (input.ratio === null &&
        input.usedTokens != null &&
        Number.isFinite(input.usedTokens) &&
        input.usedTokens >= threshold.tokens) ||
      input.items >= threshold.items ||
      input.turns >= threshold.turns
    ) {
      return level;
    }
  }
  return null;
}

const MARKDOWN_WRAPPERS = /^(?:\*\*|__|`|<|「|“|")+|(?:\*\*|__|`|>|」|”|")+$/gu;

/**
 * Strict mode only accepts a plain final `HANDOFF: /abs` line. After a request, the last few
 * lines may wrap the path in markdown, so the match stops at the `.md` name.
 */
export function parseHandoffPath(text: string, options: { strict?: boolean } = {}): string | null {
  const lines = text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (options.strict) {
    const path = lines
      .at(-1)
      ?.match(/^HANDOFF:\s+(\/\S.*)$/u)?.[1]
      ?.trim();
    return path && !path.includes("\0") ? path : null;
  }
  for (const line of lines.slice(-5).toReversed()) {
    const match = line
      .replace(MARKDOWN_WRAPPERS, "")
      .match(/^(?:[-*]\s+)?(?:\*\*)?HANDOFF(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+)$/iu);
    if (!match?.[1]) continue;
    const path = match[1]
      .trim()
      .replace(MARKDOWN_WRAPPERS, "")
      .replace(/^(.*?\.md)(?=[\s`*）)（(，,。]|$).*$/su, "$1")
      .replace(/[。．.，,；;：:]+$/u, "")
      .replace(MARKDOWN_WRAPPERS, "")
      .trim();
    if ((path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) && !path.includes("\0")) {
      return path;
    }
  }
  return null;
}

function handoffDay(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function expectedHandoffFileName(threadId: string, date = new Date()): string {
  return `HANDOFF-${threadId.slice(0, 8)}-${handoffDay(date)}.md`;
}

export function expectedHandoffPath(cwd: string, threadId: string, date = new Date()): string {
  return `${cwd.replace(/[\\/]+$/u, "")}/${expectedHandoffFileName(threadId, date)}`;
}
