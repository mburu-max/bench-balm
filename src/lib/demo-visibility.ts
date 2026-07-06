// Developer-only demo control: which nav pages are hidden for a presentation.
// Stored as a list of route `to` paths; the sidebar hides these on top of the normal
// role gating. Purely presentational — does not affect access or routing.
const KEY = "demo_hidden_pages";

export function getHiddenPages(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as string[]) : [];
  } catch {
    return [];
  }
}

export function setHiddenPages(paths: string[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(paths));
  } catch {}
}
