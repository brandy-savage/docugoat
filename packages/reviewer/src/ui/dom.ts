// The reviewer may run as a whole page or inside a host's shadow root. Dialogs must live where the
// stylesheet lives, and event targets must be read through composed paths.
let dialogHost: HTMLElement | null = null;

/** Where modal dialogs are appended: the app root when embedded, document.body otherwise. */
export function setDialogHost(el: HTMLElement | null): void {
  dialogHost = el;
}
export function mountDialog(dialog: HTMLDialogElement): void {
  (dialogHost ?? document.body).append(dialog);
}
export function openDialog(): HTMLDialogElement | null {
  return (dialogHost?.querySelector<HTMLDialogElement>('dialog[open]') ?? null) || document.querySelector<HTMLDialogElement>('dialog[open]');
}
/** The real target of an event, even when it bubbled out of a shadow tree. */
export function eventTarget(e: Event): EventTarget | null {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
  return path[0] ?? e.target;
}
