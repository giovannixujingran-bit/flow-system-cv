export const INTERACTIVE_CHILD_SELECTOR = [
  "[data-no-drag='true']",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "a",
  "[contenteditable='true']",
].join(", ");

type ClosestCapable = EventTarget | {
  closest?: (selector: string) => unknown;
} | null;

export function shouldIgnoreDragStart(
  handle: unknown,
  target: ClosestCapable,
  ignoreInteractiveChildren: boolean,
): boolean {
  if (!ignoreInteractiveChildren || !target || typeof target !== "object" || !("closest" in target) || typeof target.closest !== "function") {
    return false;
  }

  const interactiveRoot = target.closest(INTERACTIVE_CHILD_SELECTOR);
  return Boolean(interactiveRoot && interactiveRoot !== handle);
}
