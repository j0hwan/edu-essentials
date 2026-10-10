"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PrivateFile } from "../lib/files";
import { recordFileOpened } from "../lib/files-browser-activity";

type Session = { profileId: string; generation: number };
type Failure = { session: Session; file: PrivateFile; message: string; acknowledged: boolean };

/** Activity follows successful reads/saves and never delays the document itself. */
export function useFileActivity(session: Session, enabled: boolean, refresh: (signal?: AbortSignal, strict?: boolean) => Promise<void>) {
  const currentRef = useRef(session);
  const pendingRef = useRef(new Map<string, PrivateFile>());
  const runningRef = useRef<AbortController | null>(null);
  const failureRef = useRef<Failure | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [retrySession, setRetrySession] = useState<Session | null>(null);

  useLayoutEffect(() => {
    currentRef.current = session;
    runningRef.current?.abort();
    runningRef.current = null;
    pendingRef.current.clear();
    failureRef.current = null;
    return () => { runningRef.current?.abort(); };
  }, [session]);

  const drain = useCallback(async () => {
    if (runningRef.current || currentRef.current !== session || (failureRef.current?.session === session && !failureRef.current.acknowledged)) return;
    const controller = new AbortController();
    runningRef.current = controller;
    try {
      while (pendingRef.current.size && !controller.signal.aborted && currentRef.current === session) {
        const file = pendingRef.current.values().next().value as PrivateFile;
        pendingRef.current.delete(file.id);
        let acknowledged = false;
        try {
          await recordFileOpened(session.profileId, file, { signal: controller.signal });
          if (controller.signal.aborted || currentRef.current !== session) return;
          acknowledged = true;
          await refresh(controller.signal, true);
          if (controller.signal.aborted || currentRef.current !== session) return;
          const previous = failureRef.current;
          if (previous?.session === session && (previous.acknowledged || previous.file.id === file.id)) {
            failureRef.current = null;
            setFailure(null);
          }
        } catch (cause) {
          if (controller.signal.aborted || currentRef.current !== session) return;
          const next = { session, file, acknowledged, message: acknowledged ? "Recent was saved, but Files could not refresh. Retry the refresh." : cause instanceof Error ? cause.message : "Recent could not be updated. Retry when Files is available." };
          failureRef.current = next;
          setFailure(next);
          // Retain later real events until this write is retried or dismissed;
          // otherwise retrying an older event would incorrectly make it newest.
          if (!acknowledged) break;
        }
      }
    } finally {
      if (runningRef.current === controller) runningRef.current = null;
    }
  }, [refresh, session]);

  const opened = useCallback((file: PrivateFile) => {
    if (!enabled || currentRef.current !== session || file.state !== "ready" || file.trashed_at || file.deleted_at) return;
    // Coalescing retains the latest successful event's place in the queue.
    // A → B → A must acknowledge B before the latest A.
    pendingRef.current.delete(file.id);
    pendingRef.current.set(file.id, file);
    void drain();
  }, [drain, enabled, session]);

  const currentFailure = failure?.session === session ? failure : null;
  const retry = useCallback(async () => {
    if (!enabled || !currentFailure || runningRef.current || currentRef.current !== session) return;
    const controller = new AbortController();
    runningRef.current = controller;
    setRetrySession(session);
    let acknowledged = currentFailure.acknowledged;
    try {
      if (!acknowledged) await recordFileOpened(session.profileId, currentFailure.file, { signal: controller.signal });
      if (controller.signal.aborted || currentRef.current !== session) return;
      acknowledged = true;
      await refresh(controller.signal, true);
      if (!controller.signal.aborted && currentRef.current === session) { failureRef.current = null; setFailure(null); }
    } catch (cause) {
      if (!controller.signal.aborted && currentRef.current === session) {
        const next = { ...currentFailure, acknowledged, message: acknowledged ? "Recent was saved, but Files could not refresh. Retry the refresh." : cause instanceof Error ? cause.message : "Recent could not be updated." };
        failureRef.current = next;
        setFailure(next);
      }
    } finally {
      if (runningRef.current === controller) runningRef.current = null;
      if (currentRef.current === session) { setRetrySession(null); void drain(); }
    }
  }, [currentFailure, drain, enabled, refresh, session]);

  return { opened, failure: currentFailure, retrying: retrySession === session, retry, dismiss: () => { failureRef.current = null; setFailure(null); void drain(); } };
}
