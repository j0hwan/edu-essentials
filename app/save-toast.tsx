"use client";

import { AlertOctagon, Circle, LoaderCircle } from "lucide-react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

type SaveToastProps = {
  active: boolean;
  title: string;
  message?: string;
  error?: boolean;
  loading?: boolean;
  children?: ReactNode;
};

const MIN_VISIBLE_MS = 450;
const EXIT_MS = 220;

export default function SaveToast({ active, title, message, error = false, loading = false, children }: SaveToastProps) {
  const [mounted, setMounted] = useState(active);
  const [snapshot, setSnapshot] = useState({ active, title, message, error, loading, children, exiting: false });
  const activeSince = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contentChanged = snapshot.title !== title || snapshot.message !== message || snapshot.error !== error || snapshot.loading !== loading || snapshot.children !== children;
  if (active && (!snapshot.active || contentChanged)) {
    setSnapshot({ active: true, title, message, error, loading, children, exiting: false });
    if (!mounted) setMounted(true);
  } else if (!active && snapshot.active) {
    setSnapshot({ ...snapshot, active: false, exiting: false });
  }

  useEffect(() => {
    if (active) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      activeSince.current = Date.now();
      return () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
      };
    }

    if (!mounted || activeSince.current === null) return;

    const remainingVisibleTime = Math.max(0, MIN_VISIBLE_MS - (Date.now() - activeSince.current));
    timer.current = setTimeout(() => {
      setSnapshot((current) => ({ ...current, exiting: true }));
      timer.current = setTimeout(() => {
        setMounted(false);
        activeSince.current = null;
        timer.current = null;
      }, EXIT_MS);
    }, remainingVisibleTime);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [active, mounted]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const shouldRender = active || mounted;
  if (!shouldRender) return null;

  const closing = !active;
  const isError = snapshot.error;
  const isLoading = snapshot.loading;
  const hasActions = Children.toArray(snapshot.children).length > 0;

  return (
    <div
      className={`toast save-toast-card${snapshot.exiting && closing ? " is-exiting" : ""}${closing ? " is-closing" : ""}${isError ? " save-toast-error" : ""}${isError && !snapshot.title ? " is-simple-error" : ""}${!isError && !hasActions ? " is-centered" : ""}`}
      role={isError ? "alert" : "status"}
      aria-busy={isLoading || undefined}
      aria-hidden={closing || undefined}
      inert={closing || undefined}
    >
      {isError && snapshot.title && <div className="save-toast-header">
        <AlertOctagon size={18} aria-hidden="true" /><strong>{snapshot.title}</strong>
      </div>}
      <div className={`save-toast-details${isError ? " is-error-details" : ""}`}>
        {isError ? (
          snapshot.message
        ) : (
          <div className="save-toast-pending">
            <div className="save-toast-pending-main">
              {isLoading ? <LoaderCircle className="save-toast-spinner" size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />}
              <strong>{snapshot.title}</strong>
            </div>
            {snapshot.message && <span>{snapshot.message}</span>}
          </div>
        )}
      </div>
      {hasActions && <div className="save-toast-actions">{snapshot.children}</div>}
    </div>
  );
}
