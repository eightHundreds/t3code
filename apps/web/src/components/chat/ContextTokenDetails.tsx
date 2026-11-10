import { formatContextWindowTokens } from "~/lib/contextWindow";
import { useUiTranslate } from "~/uiLocale";

export function ContextTokenDetails({
  usage,
}: {
  readonly usage: {
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly cachedInputTokens?: number | null;
    readonly cacheCreationTokens?: number | null;
  };
}) {
  const t = useUiTranslate();
  const details = [
    ["Input tokens", usage.inputTokens],
    ["Output tokens", usage.outputTokens],
    ["Cache read", usage.cachedInputTokens],
    ["Cache write", usage.cacheCreationTokens],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs leading-4">
      {details.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-2">
          <span className="text-secondary-label">{t(label)}</span>
          <span className="font-medium text-secondary-label tabular-nums">
            {formatContextWindowTokens(value ?? null)}
          </span>
        </div>
      ))}
    </div>
  );
}
