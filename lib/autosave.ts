export type SaveStatus = "loading" | "load-error" | "saved" | "dirty" | "saving" | "save-error" | "conflict" | "session-error";
export type SaveState = { status: SaveStatus; ready: boolean; dirty: boolean; message: string };
export class SaveFailure extends Error {
  constructor(message: string, public kind: "save-error" | "conflict" | "session-error" = "save-error") { super(message); }
}

// PostgreSQL JSONB may reorder keys; compare content rather than key insertion order.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}

/** One writer per mounted account. Snapshots are immutable serialized documents. */
export class Autosave {
  private state: SaveState = { status: "loading", ready: false, dirty: false, message: "Loading your workspace…" };
  private listeners = new Set<() => void>();
  private latest = "";
  private saved = "";
  private revision: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = false;
  private generation = 0;
  private invalid = false;
  private uncertain = false;
  constructor(private write: (snapshot: string, revision: string | null) => Promise<string>, private delay = 700) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(status: SaveStatus, message = "") {
    this.state = { status, ready: this.state.ready, dirty: this.invalid || this.uncertain || this.writing || (this.state.ready && this.latest !== this.saved), message };
    this.listeners.forEach((listener) => listener());
  }
  stop = () => { clearTimeout(this.timer); this.generation++; this.writing = false; };
  loading = () => {
    this.stop(); this.invalid = false; this.uncertain = false;
    this.state = { status: "loading", ready: false, dirty: false, message: "Loading your workspace…" };
    this.listeners.forEach((listener) => listener());
  };
  loadFailed = (error: unknown) => this.publish(error instanceof SaveFailure && error.kind === "session-error" ? "session-error" : "load-error", error instanceof Error ? error.message : "Unable to load your workspace.");
  hydrate = (snapshot: string, revision: string | null) => {
    this.stop(); this.saved = snapshot; this.latest = snapshot; this.revision = revision; this.invalid = false; this.uncertain = false;
    this.state = { ...this.state, ready: true }; this.publish("saved");
  };
  invalidate = (message: string) => {
    if (!this.state.ready) return;
    clearTimeout(this.timer); this.invalid = true; this.publish("save-error", message);
  };
  change = (snapshot: string) => {
    if (!this.state.ready) return;
    const wasInvalid = this.invalid; this.invalid = false;
    if (snapshot === this.latest && !wasInvalid) return;
    this.latest = snapshot; clearTimeout(this.timer);
    if (["conflict", "session-error"].includes(this.state.status)) { this.publish(this.state.status, this.state.message); return; }
    if (this.writing) { this.publish("saving"); return; }
    if (this.latest === this.saved && !this.uncertain) { this.publish("saved"); return; }
    if (this.state.status === "save-error" && !wasInvalid) { this.publish("save-error", this.state.message); return; }
    this.publish("dirty"); this.schedule();
  };
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush(); }, this.delay); }
  retry = () => {
    if (!this.state.ready || this.invalid || this.state.status === "conflict" || this.writing) return;
    this.publish("dirty"); void this.flush();
  };
  flush = async () => {
    clearTimeout(this.timer);
    if (!this.state.ready || this.writing || this.invalid || ["conflict", "session-error", "save-error"].includes(this.state.status)) return;
    if (this.latest === this.saved && !this.uncertain) { this.publish("saved"); return; }
    const snapshot = this.latest, generation = this.generation;
    this.writing = true; this.publish("saving");
    try {
      const revision = await this.write(snapshot, this.revision);
      if (generation !== this.generation) return;
      this.revision = revision; this.saved = snapshot; this.writing = false; this.uncertain = false;
      if (this.invalid) { this.publish("save-error", this.state.message); return; }
      this.publish(this.latest === this.saved ? "saved" : "dirty");
      if (this.latest !== this.saved) this.schedule();
    } catch (error) {
      if (generation !== this.generation) return;
      this.writing = false; this.uncertain = true;
      this.publish(error instanceof SaveFailure ? error.kind : "save-error", error instanceof Error ? error.message : "Unable to save your workspace. Your edits are still here.");
    }
  };
}
