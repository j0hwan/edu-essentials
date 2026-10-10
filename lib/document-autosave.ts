import type { PrivateFile } from "./files";
import { safeFileItemName, validateDocumentBody } from "./file-organization";
import { DocumentSaveFailure, type DocumentDraft, type NativeDocumentResult } from "./native-documents";

export type DocumentSaveStatus = "loading" | "load-error" | "saved" | "dirty" | "saving" | "save-error" | "conflict" | "session-error";

export type DocumentAutosaveState = {
  status: DocumentSaveStatus;
  ready: boolean;
  dirty: boolean;
  message: string;
  draft: DocumentDraft;
  savedDraft?: DocumentDraft;
  file?: PrivateFile;
};

export type DocumentAutosaveWriter = (
  snapshot: DocumentDraft,
  file: PrivateFile,
  requestId: string,
) => Promise<NativeDocumentResult>;

type DocumentSaveAttempt = {
  readonly snapshot: Readonly<DocumentDraft>;
  readonly file: Readonly<PrivateFile>;
  readonly requestId: string;
};

const emptyDraft = (): DocumentDraft => ({ name: "Untitled.txt", body: "" });
const copyDraft = (draft: DocumentDraft): DocumentDraft => ({ name: draft.name, body: draft.body });
const sameDraft = (left: DocumentDraft, right: DocumentDraft) => left.name === right.name && left.body === right.body;
const isRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

function makeRequestId(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new DocumentSaveFailure("This browser cannot create a safe save request ID. Reload the document before saving.");
  }
  return crypto.randomUUID();
}

function checkedResult(result: NativeDocumentResult, attempt: DocumentSaveAttempt): void {
  const intendedName = attempt.snapshot.name.trim();
  const renamed = intendedName !== attempt.file.name;
  if (!result || !result.file || !result.document || result.file.id !== attempt.file.id ||
      result.document.file_id !== attempt.file.id || result.file.content_backend !== "native-text" || result.file.state !== "ready") {
    throw new DocumentSaveFailure("The server returned a different document. Reload the latest saved version.", "conflict");
  }
  if (typeof result.file.name !== "string" || !result.file.name.trim() || result.file.name.length > 255 ||
      [...result.file.name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\")) {
    throw new DocumentSaveFailure("The server returned an unsafe document name. Reload the latest saved version.", "conflict");
  }
  if (result.requestId !== undefined && result.requestId !== attempt.requestId) {
    throw new DocumentSaveFailure("The server acknowledged a different save request. Reload the latest saved version.", "conflict");
  }
  const acknowledgement = result.acknowledgedContentRevision;
  if (!isRevision(acknowledgement) || acknowledgement !== result.document.content_revision ||
      acknowledgement !== result.file.content_revision || acknowledgement < attempt.file.content_revision ||
      !isRevision(result.file.metadata_revision) || result.file.metadata_revision < attempt.file.metadata_revision) {
    throw new DocumentSaveFailure("The server could not confirm the saved document revision. Reload the latest saved version.", "conflict");
  }
  if (result.document.body !== attempt.snapshot.body || (renamed && result.file.name !== intendedName)) {
    throw new DocumentSaveFailure("The document changed while this save was in progress. Your draft is still here; reload the latest saved version.", "conflict");
  }
}

/** One serialized writer for a mounted profile/document pair. */
export class DocumentAutosave {
  private state: DocumentAutosaveState = {
    status: "loading",
    ready: false,
    dirty: false,
    message: "Loading your document…",
    draft: emptyDraft(),
  };
  private listeners = new Set<() => void>();
  private waiters = new Set<() => void>();
  private latest = emptyDraft();
  private saved = emptyDraft();
  private file: PrivateFile | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writing = false;
  private generation = 0;
  private invalid = false;
  private retryRequired = false;
  private attempt: DocumentSaveAttempt | undefined;

  constructor(private readonly writer: DocumentAutosaveWriter, private readonly delay = 750) {}

  getSnapshot = (): DocumentAutosaveState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private releaseWaiters(): void {
    for (const resolve of [...this.waiters]) resolve();
  }

  private publish(status: DocumentSaveStatus, message = ""): void {
    const ready = this.state.ready;
    const dirty = this.invalid || this.writing || this.attempt !== undefined || (ready && !sameDraft(this.latest, this.saved));
    this.state = {
      status,
      ready,
      dirty,
      message,
      draft: copyDraft(this.latest),
      ...(this.file ? { savedDraft: copyDraft(this.saved) } : {}),
      ...(this.file ? { file: { ...this.file } } : {}),
    };
    this.listeners.forEach((listener) => listener());
    this.releaseWaiters();
  }

  private waitForUpdate(generation: number): Promise<void> {
    return new Promise((resolve) => {
      let released = false;
      const finish = () => {
        if (released) return;
        released = true;
        this.waiters.delete(finish);
        resolve();
      };
      this.waiters.add(finish);
      if (generation !== this.generation) finish();
    });
  }

  stop = (): void => {
    clearTimeout(this.timer);
    this.timer = undefined;
    const interrupted = this.writing;
    this.generation += 1;
    this.writing = false;
    if (interrupted) {
      this.retryRequired = true;
      this.publish("save-error", "The save was interrupted. Your draft is still here; retry before leaving.");
    } else {
      this.releaseWaiters();
    }
  };

  loading = (): void => {
    this.stop();
    this.latest = emptyDraft();
    this.saved = emptyDraft();
    this.file = undefined;
    this.attempt = undefined;
    this.invalid = false;
    this.retryRequired = false;
    this.state = { status: "loading", ready: false, dirty: false, message: "Loading your document…", draft: copyDraft(this.latest) };
    this.listeners.forEach((listener) => listener());
    this.releaseWaiters();
  };

  loadFailed = (error: unknown): void => {
    const message = error instanceof Error ? error.message : "Unable to load this document.";
    const status = error instanceof DocumentSaveFailure && error.kind === "session-error" ? "session-error" : "load-error";
    this.state = { status, ready: false, dirty: false, message, draft: copyDraft(this.latest) };
    this.listeners.forEach((listener) => listener());
    this.releaseWaiters();
  };

  hydrate = (result: NativeDocumentResult): void => {
    this.stop();
    if (!result?.file || !result.document || result.file.id !== result.document.file_id ||
        result.file.content_backend !== "native-text" || result.file.state !== "ready" ||
        !isRevision(result.file.content_revision) || result.file.content_revision !== result.document.content_revision ||
        !isRevision(result.file.metadata_revision) || typeof result.document.body !== "string") {
      throw new DocumentSaveFailure("The saved document data is incomplete or out of date. Reload Files before continuing.", "conflict");
    }
    this.file = { ...result.file };
    this.saved = { name: result.file.name, body: result.document.body };
    this.latest = copyDraft(this.saved);
    this.attempt = undefined;
    this.invalid = false;
    this.retryRequired = false;
    this.state = { status: "saved", ready: true, dirty: false, message: "", draft: copyDraft(this.latest), savedDraft: copyDraft(this.saved), file: { ...result.file } };
    this.listeners.forEach((listener) => listener());
    this.releaseWaiters();
  };

  invalidate = (message: string): void => {
    if (!this.state.ready) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.invalid = true;
    this.publish("save-error", message);
  };

  change = (draft: DocumentDraft): void => {
    if (!this.state.ready || !draft || typeof draft.name !== "string" || typeof draft.body !== "string") return;
    const wasInvalid = this.invalid;
    if (sameDraft(draft, this.latest) && !wasInvalid) return;
    this.latest = copyDraft(draft);
    this.invalid = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (["conflict", "session-error"].includes(this.state.status)) {
      this.publish(this.state.status, this.state.message);
      return;
    }
    if (this.retryRequired || (this.state.status === "save-error" && !wasInvalid)) {
      this.publish("save-error", this.state.message);
      return;
    }
    if (this.writing) {
      this.publish("saving", "Saving your document…");
      return;
    }
    if (!this.isDirty()) {
      this.publish("saved", "");
      return;
    }
    this.publish("dirty", "Unsaved changes");
    this.schedule();
  };

  private isDirty(): boolean {
    return this.invalid || this.writing || this.attempt !== undefined || !sameDraft(this.latest, this.saved);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startWrite(this.generation);
    }, this.delay);
  }

  private makeAttempt(): DocumentSaveAttempt {
    if (!this.file) throw new DocumentSaveFailure("Reload the saved document before editing.", "conflict");
    const snapshot = Object.freeze(copyDraft(this.latest));
    const file = Object.freeze({ ...this.file });
    return Object.freeze({ snapshot, file, requestId: makeRequestId() });
  }

  private startWrite(generation: number): void {
    if (generation !== this.generation || !this.state.ready || this.writing || this.invalid || this.retryRequired ||
        ["conflict", "session-error", "save-error", "load-error"].includes(this.state.status)) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.attempt && sameDraft(this.latest, this.saved)) {
      this.publish("saved", "");
      return;
    }
    try {
      if (!this.attempt) {
        safeFileItemName(this.latest.name);
        validateDocumentBody(this.latest.body);
      }
      this.attempt ??= this.makeAttempt();
    } catch (error) {
      const failure = error instanceof DocumentSaveFailure
        ? error
        : new DocumentSaveFailure(error instanceof Error ? error.message : "Unable to prepare this document save.");
      this.invalid = true;
      this.retryRequired = false;
      this.publish(failure.kind, failure.message);
      return;
    }
    const attempt = this.attempt;
    this.writing = true;
    this.publish("saving", "Saving your document…");
    void this.writeAttempt(attempt, generation);
  }

  private async writeAttempt(attempt: DocumentSaveAttempt, generation: number): Promise<void> {
    try {
      const result = await this.writer(copyDraft(attempt.snapshot as DocumentDraft), { ...attempt.file }, attempt.requestId);
      if (generation !== this.generation) return;
      checkedResult(result, attempt);
      this.file = { ...result.file };
      this.saved = { name: result.file.name, body: attempt.snapshot.body };
      if (this.latest.name === attempt.snapshot.name) this.latest = { ...this.latest, name: result.file.name };
      this.attempt = undefined;
      this.writing = false;
      this.retryRequired = false;
      if (this.invalid) {
        this.publish("save-error", this.state.message);
        return;
      }
      if (sameDraft(this.latest, this.saved)) {
        this.publish("saved", "");
      } else {
        this.publish("dirty", "Unsaved changes");
        this.schedule();
      }
    } catch (error) {
      if (generation !== this.generation) return;
      this.writing = false;
      const failure = error instanceof DocumentSaveFailure
        ? error
        : new DocumentSaveFailure(error instanceof Error ? error.message : "Unable to save your document. Your draft is still here; retry the save.");
      this.retryRequired = failure.kind !== "conflict";
      this.publish(failure.kind, failure.message);
    }
  }

  flush = async (): Promise<void> => this.flushLatest(false);

  flushLatest = async (retry = false): Promise<void> => {
    const generation = this.generation;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (retry && this.state.ready && !this.invalid && !this.writing &&
        ["save-error", "session-error"].includes(this.state.status)) {
      this.retryRequired = false;
      this.publish("dirty", "Unsaved changes");
    }
    while (generation === this.generation) {
      if (!this.state.ready || this.invalid || this.retryRequired ||
          ["conflict", "session-error", "save-error", "load-error"].includes(this.state.status)) return;
      if (!this.isDirty()) {
        this.publish("saved", "");
        return;
      }
      if (!this.writing) this.startWrite(generation);
      if (!this.writing) continue;
      await this.waitForUpdate(generation);
    }
  };

  retry = async (): Promise<void> => this.flushLatest(true);
}
