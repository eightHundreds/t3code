import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { EnvironmentThreadShell, ThreadStructure } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { CommandId, MessageId, ThreadId, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { formatContextWindowTokens } from "~/lib/contextWindow";
import { newMessageId, newThreadId, randomUUID } from "~/lib/utils";
import { buildThreadRouteParams } from "~/threadRoutes";
import { cn } from "~/lib/utils";
import { useUiTranslate } from "~/uiLocale";
import { waitForThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { ContextTokenDetails } from "./ContextTokenDetails";
import {
  contextRatio,
  expectedHandoffFileName,
  expectedHandoffPath,
  hasHandoffBudgetFailure,
  longConversationLevel,
  parseHandoffPath,
} from "./contextHandoff";

type HandoffPhase = "idle" | "requested" | "failed" | "continued";

interface HandoffRecord {
  readonly phase: HandoffPhase;
  readonly commandId?: string;
  readonly messageId?: string;
  readonly fileName?: string;
  readonly absolutePath?: string;
  readonly continuationThreadId?: string;
  readonly continuationCommandId?: string;
  readonly continuationMessageId?: string;
  readonly settleCommandId?: string;
  readonly error?: string | undefined;
}

const EMPTY_RECORD: HandoffRecord = { phase: "idle" };

function storageKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `t3-context-handoff:${environmentId}:${threadId}`;
}

function readRecord(key: string): HandoffRecord {
  if (typeof localStorage === "undefined") return EMPTY_RECORD;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY_RECORD;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_RECORD;
    const record = parsed as Partial<HandoffRecord>;
    if (
      record.phase !== "requested" &&
      record.phase !== "failed" &&
      record.phase !== "continued" &&
      record.phase !== "idle"
    ) {
      return EMPTY_RECORD;
    }
    return { ...EMPTY_RECORD, ...record, phase: record.phase };
  } catch {
    return EMPTY_RECORD;
  }
}

function writeRecord(key: string, record: HandoffRecord): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(record));
}

function commandError(
  result: AtomCommandResult<unknown, unknown>,
  fallback: string,
): string | null {
  if (result._tag !== "Failure") return null;
  if (isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

export function ContextSessionPanel({
  environmentId,
  thread,
  projection,
  usage,
  workspaceRoot,
  pendingSubtasks,
  canCompact,
  onCompact,
}: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly projection: ThreadStructure | null;
  readonly usage: ContextWindowSnapshot;
  readonly workspaceRoot: string | null;
  readonly pendingSubtasks: number;
  readonly canCompact: boolean;
  readonly onCompact: () => void;
}) {
  const t = useUiTranslate();
  const navigate = useNavigate();
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const settle = useOrchestrationCommand(threadEnvironment.settle, { reportFailure: false });
  const key = storageKey(environmentId, thread.id);
  const [sessionKey, setSessionKey] = useState(key);
  const [record, setRecord] = useState(() => readRecord(key));
  const [busy, setBusy] = useState(false);
  if (sessionKey !== key) {
    setSessionKey(key);
    setRecord(readRecord(key));
    setBusy(false);
  }

  const remember = (next: HandoffRecord) => {
    writeRecord(key, next);
    setRecord(next);
  };

  const handoffFile = useProjectFileQuery(
    environmentId,
    workspaceRoot ?? "",
    record.fileName ?? null,
    workspaceRoot !== null && (record.phase === "requested" || record.phase === "failed"),
  );
  const fileFound = handoffFile.isFile && handoffFile.error === null;
  const lastAssistant = projection?.messages.findLast(
    (message) => message.role === "assistant" && !message.streaming && message.text.length > 0,
  );
  const parsedPath =
    record.phase === "requested" || record.phase === "failed"
      ? parseHandoffPath(lastAssistant?.text ?? "")
      : null;
  const discoveredPath = parsedPath ?? (fileFound ? (record.absolutePath ?? null) : null);
  const phase: HandoffPhase | "ready" =
    record.phase === "continued" ? "continued" : discoveredPath ? "ready" : record.phase;
  const maxTokens = usage.maxTokens ?? null;
  const ratio = contextRatio(usage);
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const level = longConversationLevel({
    relationshipToParent: thread.lineage.relationshipToParent,
    items: thread.itemCount,
    turns: projection?.runs.length ?? 0,
    ratio,
    usedTokens: usage.usedTokens,
  });
  const budgetExceeded = projection !== null && hasHandoffBudgetFailure(projection);
  const subagent = thread.lineage.relationshipToParent === "subagent";
  const label =
    phase === "failed"
      ? t("Handoff failed")
      : phase === "continued"
        ? t("Handed off")
        : phase === "requested"
          ? t("Writing handoff")
          : phase === "ready"
            ? t("Handoff ready")
            : percent === null
              ? formatContextWindowTokens(usage.usedTokens)
              : `${percent}%`;

  const requestHandoff = async () => {
    if (busy || workspaceRoot === null || subagent) return;
    const previous = record;
    const commandId = record.commandId ?? randomUUID();
    const messageId = record.messageId ?? newMessageId();
    const brandedMessageId = MessageId.make(messageId);
    const dated = new Date();
    const fileName = record.fileName ?? expectedHandoffFileName(thread.id, dated);
    const absolutePath =
      record.absolutePath ?? expectedHandoffPath(workspaceRoot, thread.id, dated);
    const next: HandoffRecord = {
      phase: "requested",
      commandId,
      messageId,
      fileName,
      absolutePath,
    };
    remember(next);
    setBusy(true);
    const subtasks =
      pendingSubtasks > 0
        ? t(
            "This session still has {count} delegated tasks. List each task id, its status, and how the new session collects the result. Results still return to this session.",
            { count: pendingSubtasks },
          )
        : "";
    const text = t(
      "Stop expanding this task and write a handoff to this file: {path}\nInclude the goal, what is done, where the evidence is, what is left, decisions the user must make, and how to roll back. Keep only what is still true. Do not copy the chat transcript. {subtasks}\nEnd the reply with one plain line and no formatting, for example:\nHANDOFF: {path}\nAfter the handoff is written, stop. Do not take a new task.",
      { path: absolutePath, subtasks },
    );
    const result = await startTurn({
      environmentId,
      input: {
        commandId: CommandId.make(commandId),
        threadId: thread.id,
        createdAt: new Date().toISOString(),
        message: { messageId: brandedMessageId, role: "user", text, attachments: [] },
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        dispatchMode: "queue",
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) {
        remember(previous);
        return;
      }
      remember({
        ...next,
        phase: "failed",
        error: commandError(result, t("Could not hand off this session.")) ?? undefined,
      });
    }
  };

  const continueSession = async (handoffPath: string | null) => {
    if (busy || subagent) return;
    const previous = record;
    const continuationThreadId = ThreadId.make(record.continuationThreadId ?? newThreadId());
    const continuationCommandId = record.continuationCommandId ?? randomUUID();
    const continuationMessageId = MessageId.make(record.continuationMessageId ?? newMessageId());
    const settleCommandId = record.settleCommandId ?? randomUUID();
    const next: HandoffRecord = {
      ...record,
      phase: record.phase === "idle" ? "requested" : record.phase,
      continuationThreadId,
      continuationCommandId,
      continuationMessageId,
      settleCommandId,
    };
    remember(next);
    setBusy(true);
    const text =
      handoffPath === null
        ? t(
            'Continue the session "{title}" ({threadId}). There is no handoff file. Read the old session with t3_thread_read, using threadId {threadId}, the message view, limit 50, and maxCharsPerItem 4000. Keep paging with nextPosition as afterPosition until hasMore is false, and continue a long message from nextTextOffset. Write the goal, what is done, what is left, and the decisions for the user into a HANDOFF file in this directory, then continue the unfinished work. Ask only when you are unsure. Do not guess at anything you have not read.',
            { title: thread.title, threadId: thread.id },
          )
        : t(
            'Continue the session "{title}" ({threadId}). Read {path} completely and continue its unfinished work. Do not redo what it already verified.',
            { title: thread.title, threadId: thread.id, path: handoffPath },
          );
    const started = await startTurn({
      environmentId,
      input: {
        commandId: CommandId.make(continuationCommandId),
        threadId: continuationThreadId,
        createdAt: new Date().toISOString(),
        message: {
          messageId: continuationMessageId,
          role: "user",
          text,
          attachments: [],
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        bootstrap: {
          createThread: {
            projectId: thread.projectId,
            title: t("{title} (continued)", { title: thread.title }),
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
            createdAt: new Date().toISOString(),
          },
        },
      },
    });
    if (started._tag === "Failure") {
      setBusy(false);
      if (isAtomCommandInterrupted(started)) {
        remember(previous);
        return;
      }
      remember({
        ...next,
        phase: "failed",
        error: commandError(started, t("Could not start the new session.")) ?? undefined,
      });
      return;
    }
    const settled = await settle({
      environmentId,
      input: { threadId: thread.id, commandId: CommandId.make(settleCommandId) },
    });
    const settleError =
      settled._tag === "Failure" && !isAtomCommandInterrupted(settled)
        ? (commandError(settled, t("Could not settle this session.")) ??
          t("Could not settle this session."))
        : undefined;
    const continued: HandoffRecord = {
      ...next,
      phase: "continued",
      error: settleError,
    };
    remember(continued);
    setBusy(false);
    const target = scopeThreadRef(environmentId, continuationThreadId);
    await waitForThreadShell(target);
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(target),
    });
  };

  const openContinued = () => {
    if (record.continuationThreadId === undefined) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(environmentId, ThreadId.make(record.continuationThreadId)),
      ),
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          percent === null
            ? t("Context {tokens}", { tokens: formatContextWindowTokens(usage.usedTokens) })
            : t("Context {percent}%", { percent })
        }
        render={
          <Button
            size="xs"
            variant={
              budgetExceeded || phase === "failed"
                ? "ghost-destructive"
                : level === "strong"
                  ? "warning-outline"
                  : "ghost-muted"
            }
          />
        }
      >
        <span className="tabular-nums">{label}</span>
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" side="top" align="end">
        <div className="flex flex-col gap-3">
          <PopoverTitle>{budgetExceeded ? t("Context is full") : t("Context")}</PopoverTitle>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground tabular-nums">
              {maxTokens !== null && maxTokens > 0
                ? `${formatContextWindowTokens(usage.usedTokens)} / ${formatContextWindowTokens(maxTokens)}`
                : formatContextWindowTokens(usage.usedTokens)}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {percent === null ? "" : `${percent}%`}
            </span>
          </div>
          {percent !== null ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full",
                  percent >= 90
                    ? "bg-destructive"
                    : percent >= 80
                      ? "bg-warning"
                      : "bg-foreground/70",
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          ) : null}
          <ContextTokenDetails usage={usage} />
          {record.error ? <p className="text-xs text-destructive">{record.error}</p> : null}
          {subagent ? null : (
            <div className="flex flex-col gap-1.5">
              {phase === "continued" ? (
                <Button size="xs" variant="outline" disabled={busy} onClick={openContinued}>
                  {t("Open the new session")}
                </Button>
              ) : phase === "ready" || phase === "requested" || phase === "failed" ? (
                <>
                  {discoveredPath !== null ? (
                    <Button
                      size="xs"
                      disabled={busy}
                      onClick={() => void continueSession(discoveredPath)}
                    >
                      {t("Continue in a new session")}
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void continueSession(null)}
                    >
                      {t("Continue without a handoff file")}
                    </Button>
                  )}
                  {phase === "failed" ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || workspaceRoot === null}
                      onClick={() => void requestHandoff()}
                    >
                      {t("Try the handoff again")}
                    </Button>
                  ) : null}
                </>
              ) : (
                <Button
                  size="xs"
                  disabled={busy || workspaceRoot === null}
                  onClick={() => void requestHandoff()}
                >
                  {t("Hand off to a new session")}
                </Button>
              )}
              {canCompact && phase !== "continued" ? (
                <Button size="xs" variant="ghost" disabled={busy} onClick={onCompact}>
                  {t("Compact this session")}
                </Button>
              ) : null}
              {workspaceRoot === null ? (
                <p className="text-xs text-muted-foreground">
                  {t("This session has no project folder, so it cannot write a handoff file.")}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
