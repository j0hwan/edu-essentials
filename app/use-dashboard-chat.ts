"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Answer, Citation } from "../lib/ai/contracts";

export type DashboardChatMessage = {
  id: string;
  question: string;
  status: string;
  conversationId?: string;
  error?: string;
  result?: { answer: Answer; citations: Citation[]; proposalId: string | null };
};
type Access = { eligible: boolean; enabled?: boolean };
type Conversation = { id: string; title: string };
type ApiMessage = DashboardChatMessage;
const POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 1000;

function waitForPoll(signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(false);
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(true); }, POLL_INTERVAL_MS);
    const cancel = () => { clearTimeout(timer); resolve(false); };
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export function useDashboardChat({ profileId, prepare, experimental }: { profileId: string; prepare: () => Promise<void>; experimental: boolean }) {
  const [messages, setMessages] = useState<DashboardChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const conversation = useRef<{ profileId: string; id: string } | null>(null);
  const [session, setSession] = useState({ profileId, experimental });
  if (session.profileId !== profileId || session.experimental !== experimental) {
    setSession({ profileId, experimental });
    setMessages([]);
    setBusy(false);
  }
  const mounted = useRef(false);
  const latestPrepare = useRef(prepare);
  useLayoutEffect(() => { latestPrepare.current = prepare; }, [prepare]);

  useLayoutEffect(() => {
    mounted.current = true;
    busyRef.current = false;
    conversation.current = null;
    return () => {
      mounted.current = false;
      active.current?.abort();
      active.current = null;
      busyRef.current = false;
    };
  }, [profileId, experimental]);

  const send = useCallback((question: string): boolean => {
    const text = question.trim();
    if (!text || busyRef.current) return false;
    const id = crypto.randomUUID();
    const turn: DashboardChatMessage = { id, question, status: "running" };
    setMessages((old) => [...old, turn]);
    if (experimental) {
      setMessages((old) => old.map((message) => message.id === id ? { ...message, status: "failed", error: "Exit experimental mode to use AI chat with a saved test account." } : message));
      return true;
    }

    const controller = new AbortController();
    const ownerProfile = profileId;
    active.current = controller;
    busyRef.current = true;
    setBusy(true);
    const current = () => mounted.current && !controller.signal.aborted && active.current === controller;
    const updateTurn = (update: Partial<DashboardChatMessage>) => {
      if (current()) setMessages((old) => old.map((message) => message.id === id ? { ...message, ...update } : message));
    };
    const api = async <T,>(resource: string, init: RequestInit = {}): Promise<T> => {
      const response = await fetch(`/api/ai/${resource}`, {
        ...init,
        signal: controller.signal,
        cache: "no-store",
        headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)), "x-profile-id": ownerProfile },
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Assistant request failed.");
      return data as T;
    };
    void (async () => {
      try {
        const access = await api<Access>("access");
        if (!current()) return;
        if (!access.eligible || !access.enabled) throw new Error("Your academic assistant is not enabled for this account. Enable it in the assistant settings before chatting.");
        await latestPrepare.current();
        if (!current()) return;
        let conversationId = conversation.current?.profileId === ownerProfile ? conversation.current.id : "";
        if (!conversationId) {
          const created = await api<Conversation>("conversations", { method: "POST", body: JSON.stringify({ title: text.slice(0, 100) }) });
          if (!current()) return;
          conversationId = created.id;
          conversation.current = { profileId: ownerProfile, id: conversationId };
        }
        updateTurn({ conversationId });
        const posted = await api<ApiMessage>("messages", { method: "POST", body: JSON.stringify({ conversationId, requestId: id, message: question }) });
        if (!current()) return;
        if (posted.status === "failed") throw new Error(posted.error || "The assistant could not answer. Try again.");
        if (posted.status === "complete") {
          if (!posted.result) throw new Error("The assistant returned an empty answer. Try again.");
          updateTurn({ ...posted, id, question, status: "complete" });
          return;
        }
        updateTurn({ status: "running" });
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
          if (!current()) return;
          const result = await api<{ messages: ApiMessage[] }>(`messages?conversationId=${encodeURIComponent(conversationId)}`);
          if (!current()) return;
          const message = result.messages.find((candidate) => candidate.id === id);
          if (message?.status === "failed") throw new Error(message.error || "The assistant could not answer. Try again.");
          if (message?.status === "complete") {
            if (!message.result) throw new Error("The assistant returned an empty answer. Try again.");
            updateTurn({ ...message, id, question, status: "complete" });
            return;
          }
          if (attempt < POLL_ATTEMPTS - 1 && !await waitForPoll(controller.signal)) return;
        }
        throw new Error("The assistant is taking longer than expected. Try again.");
      } catch (error) {
        if (current()) updateTurn({ status: "failed", error: error instanceof Error ? error.message : "Assistant request failed." });
      } finally {
        if (active.current === controller) {
          active.current = null;
          busyRef.current = false;
          if (mounted.current) setBusy(false);
        }
      }
    })();
    return true;
  }, [experimental, profileId]);

  return { messages, busy, send };
}
