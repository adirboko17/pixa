import type { BlueprintLayout } from "@/lib/blueprint-annotations";

export function parseBlueprintLayout(value: unknown): BlueprintLayout | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Partial<BlueprintLayout>;
  if (typeof o.canvasW !== "number" || typeof o.canvasH !== "number") {
    return undefined;
  }
  if (!Array.isArray(o.plates) || o.plates.length === 0) return undefined;
  return o as BlueprintLayout;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPersistedItemId(id: string): boolean {
  return UUID_RE.test(id);
}
