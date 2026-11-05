"use client";

import { useEffect, useRef, useState } from "react";

const RETRY_DELAY_SECONDS = 5;

export default function WorkspaceLoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  const [secondsRemaining, setSecondsRemaining] = useState(RETRY_DELAY_SECONDS);
  const onRetryRef = useRef(onRetry);
  const timersRef = useRef<{ interval: ReturnType<typeof setInterval>; timeout: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => { onRetryRef.current = onRetry; }, [onRetry]);

  useEffect(() => {
    const deadline = Date.now() + RETRY_DELAY_SECONDS * 1000;
    const interval = setInterval(() => {
      setSecondsRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      timersRef.current = null;
      setSecondsRemaining(0);
      onRetryRef.current();
    }, RETRY_DELAY_SECONDS * 1000);
    timersRef.current = { interval, timeout };
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      timersRef.current = null;
    };
  }, []);

  function retryNow() {
    if (timersRef.current) {
      clearInterval(timersRef.current.interval);
      clearTimeout(timersRef.current.timeout);
      timersRef.current = null;
    }
    setSecondsRemaining(0);
    onRetryRef.current();
  }

  return (
    <section className="workspace-loading is-error" role="alert">
      <h1>{title}</h1>
      <p>{secondsRemaining > 0 ? `Retrying in ${secondsRemaining} seconds...` : "Retrying now..."}</p>
      <button type="button" onClick={retryNow}>Click here to retry</button>
    </section>
  );
}
