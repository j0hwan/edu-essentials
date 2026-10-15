import { ArrowRight, ArrowUp, CheckCircle2, ChevronLeft, ChevronRight, ChevronUp, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createCourseExpansionProgressFrames, COURSE_EXPANSION_MOTION_DURATION_MS, COURSE_EXPANSION_MOTION_EASING } from "../lib/course-expansion-motion";
import type { Answer, Citation } from "../lib/ai/contracts";
import { dashboardSummaryShape } from "../lib/dashboard-summary-shape";
import type { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { SavedAssignment } from "../lib/workspace-codec";
import { useAskSuggestions } from "./use-ask-suggestions";

const STUDY_SUMMARY = "I’d start with the work that needs your attention most, then give you a head start on the next deadline. Your week looks manageable—let’s take it one priority at a time.";
const STUDY_SUMMARY_TYPING_DURATION_MS = 2500;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PRIORITIES_PER_PAGE = 2;
const PRIORITY_SWIPE_THRESHOLD = 40;

function subscribeToReducedMotion(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};

  const preference = window.matchMedia(REDUCED_MOTION_QUERY);
  const listener = () => onChange();
  if (preference.addEventListener) {
    preference.addEventListener("change", listener);
    return () => preference.removeEventListener("change", listener);
  }

  preference.addListener(listener);
  return () => preference.removeListener(listener);
}

function getSystemReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

type Props = {
  focusAssignments: SavedAssignment[];
  overdueCount: number;
  dueTodayCount: number;
  completedThisWeek: number;
  courseCount: number;
  courseCodeFor: (courseId: string) => string;
  renderStatusBadge: (status: SavedAssignment["status"]) => ReactNode;
  onSelectAssignment: (assignment: SavedAssignment) => void;
  onAddAssignment: () => void;
  onAddClass: () => void;
  onOpenAssistant: (draft?: string, conversationId?: string, proposalId?: string) => void;
  onAskAssistant: (question: string) => boolean | void;
  onContinueAssistant?: (question: string, conversationId?: string) => boolean | void;
  chatMessages?: { id: string; question: string; status: string; conversationId?: string; error?: string; result?: { answer: Answer; citations: Citation[]; proposalId: string | null } }[];
  chatBusy?: boolean;
  reducedMotion?: boolean;
};

function priorityAdvice(assignment: SavedAssignment) {
  if (assignment.status === "overdue") return "Clear this first to get back on track.";
  if (assignment.status === "today") return "Make time for this before the day ends.";
  return "Get a head start on your next deadline.";
}

export default function DashboardStudyBrief({
  focusAssignments,
  overdueCount,
  dueTodayCount,
  completedThisWeek,
  courseCount,
  courseCodeFor,
  renderStatusBadge,
  onSelectAssignment,
  onAddAssignment,
  onAddClass,
  onOpenAssistant,
  onAskAssistant,
  onContinueAssistant,
  chatMessages = [],
  chatBusy = false,
  reducedMotion = false,
}: Props) {
  const [question, setQuestion] = useState("");
  const [askFocused, setAskFocused] = useState(false);
  const systemReducedMotion = useSyncExternalStore(subscribeToReducedMotion, getSystemReducedMotion, () => false);
  const shouldReduceMotion = reducedMotion || systemReducedMotion;
  const [chatOpen, setChatOpen] = useState<boolean | null>(null);
  const chatExpanded = chatOpen ?? (chatMessages.length > 0);
  const showChatToggle = chatOpen !== null || chatMessages.length > 0;
  const chatRegion = useRef<HTMLDivElement>(null);
  const chatLog = useRef<HTMLDivElement>(null);
  const chatAnimation = useRef<Animation | null>(null);
  const shellAnimation = useRef<Animation | null>(null);
  const shell = useRef<HTMLElement>(null);
  const outline = useRef<SVGPathElement>(null);

  useLayoutEffect(() => {
    const section = shell.current;
    const path = outline.current;
    if (!section || !path) return;
    const summary = section.querySelector<HTMLElement>(".dashboard-study-summary")!;
    const priorities = section.querySelector<HTMLElement>(".dashboard-focus")!;
    const lead = section.querySelector<HTMLElement>(".dashboard-study-lead")!;
    const footer = section.querySelector<HTMLElement>(".dashboard-study-footer")!;
    const updateShape = () => {
      const bounds = section.getBoundingClientRect();
      if (bounds.width <= 1 || bounds.height <= 1) return;
      const focusBounds = priorities.getBoundingClientRect();
      const summaryBounds = summary.getBoundingClientRect();
      const styles = window.getComputedStyle(section);
      const stacked = focusBounds.left < summaryBounds.right;
      const bottomPadding = Number.parseFloat(styles.paddingBottom) + 1;
      const collapsedBottom = Math.max(
        focusBounds.bottom,
        lead.getBoundingClientRect().bottom + footer.getBoundingClientRect().height,
      ) - bounds.top + bottomPadding;
      const shape = dashboardSummaryShape({
        width: bounds.width,
        height: bounds.height,
        split: stacked ? bounds.width : focusBounds.left - bounds.left,
        baseHeight: stacked ? bounds.height : collapsedBottom,
        radius: Number.parseFloat(styles.borderTopLeftRadius),
      });
      path.setAttribute("d", shape);
      section.style.setProperty("--summary-shell-path", `path("${shape}")`);
      section.dataset.shaped = "true";
    };
    updateShape();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateShape) : null;
    for (const element of [section, summary, priorities, lead, footer]) observer?.observe(element, { box: "border-box" });
    window.addEventListener("resize", updateShape);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateShape);
    };
  }, []);

  useLayoutEffect(() => {
    const region = chatRegion.current;
    const section = shell.current;
    if (!region || !section) return;
    const fromHeight = region.getBoundingClientRect().height;
    const fromPadding = Number.parseFloat(window.getComputedStyle(section).paddingBottom) || 0;
    chatAnimation.current?.cancel();
    chatAnimation.current = null;
    shellAnimation.current?.cancel();
    shellAnimation.current = null;
    const basePadding = Number.parseFloat(window.getComputedStyle(section).paddingBottom) || 0;
    region.style.height = chatExpanded ? "280px" : "0px";
    if (shouldReduceMotion || typeof region.animate !== "function") return;
    const toHeight = chatExpanded ? 280 : 0;
    if (fromHeight === toHeight && fromPadding === basePadding) return;
    const frames = createCourseExpansionProgressFrames();
    const options = { duration: COURSE_EXPANSION_MOTION_DURATION_MS, easing: COURSE_EXPANSION_MOTION_EASING };
    const animation = region.animate(frames.map(({ offset, progress }) => ({
      offset,
      height: `${Math.max(0, fromHeight + (toHeight - fromHeight) * progress)}px`,
    })), options);
    chatAnimation.current = animation;
    if (!chatExpanded || fromPadding !== basePadding) {
      shellAnimation.current = section.animate(frames.map(({ offset, progress }) => ({
        offset,
        paddingBottom: `${Math.max(0, fromPadding + (basePadding - fromPadding) * progress
          + (chatExpanded ? 0 : Math.min(0, fromHeight * (1 - progress))))}px`,
      })), options);
    }
  }, [chatExpanded, shouldReduceMotion]);

  useLayoutEffect(() => () => {
    chatAnimation.current?.cancel();
    shellAnimation.current?.cancel();
  }, []);

  useEffect(() => {
    const log = chatLog.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chatMessages, chatBusy]);
  const [visibleCharacters, setVisibleCharacters] = useState(() => shouldReduceMotion ? STUDY_SUMMARY.length : 0);
  if (shouldReduceMotion && visibleCharacters < STUDY_SUMMARY.length) {
    setVisibleCharacters(STUDY_SUMMARY.length);
  }
  const visibleCharactersRef = useRef(visibleCharacters);

  useEffect(() => {
    visibleCharactersRef.current = visibleCharacters;
  }, [visibleCharacters]);

  useEffect(() => {
    if (shouldReduceMotion || visibleCharactersRef.current >= STUDY_SUMMARY.length) return;

    const tickDuration = 16;
    const elapsedBeforeResume = (visibleCharactersRef.current / STUDY_SUMMARY.length) * STUDY_SUMMARY_TYPING_DURATION_MS;
    const startedAt = window.performance.now() - elapsedBeforeResume;
    const interval = window.setInterval(() => {
      const elapsed = Math.min(window.performance.now() - startedAt, STUDY_SUMMARY_TYPING_DURATION_MS);
      const nextCharacters = Math.min(
        STUDY_SUMMARY.length,
        Math.floor((elapsed / STUDY_SUMMARY_TYPING_DURATION_MS) * STUDY_SUMMARY.length),
      );
      setVisibleCharacters((current) => Math.max(current, nextCharacters));
      if (nextCharacters === STUDY_SUMMARY.length) {
        window.clearInterval(interval);
      }
    }, tickDuration);

    return () => window.clearInterval(interval);
  }, [shouldReduceMotion]);

  const summaryCharacters = shouldReduceMotion ? STUDY_SUMMARY.length : visibleCharacters;
  const askPlaceholder = useAskSuggestions({
    active: summaryCharacters === STUDY_SUMMARY.length,
    paused: askFocused || question.length > 0,
    reducedMotion: shouldReduceMotion,
  });
  const showAskSuggestion = summaryCharacters === STUDY_SUMMARY.length
    && !askFocused
    && question.length === 0
    && !shouldReduceMotion;
  const assignmentSequence = JSON.stringify(focusAssignments.map((assignment) => assignment.id));
  const [priorityState, setPriorityState] = useState({ sequence: assignmentSequence, page: 0 });
  const priorityPage = priorityState.sequence === assignmentSequence ? priorityState.page : 0;
  if (priorityState.sequence !== assignmentSequence) {
    setPriorityState({ sequence: assignmentSequence, page: 0 });
  }
  const priorityPageCount = Math.ceil(focusAssignments.length / PRIORITIES_PER_PAGE);
  const priorityStartIndex = priorityPage * PRIORITIES_PER_PAGE;
  const visiblePriorities = focusAssignments.slice(priorityStartIndex, priorityStartIndex + PRIORITIES_PER_PAGE);
  const priorityRangeEnd = priorityStartIndex + visiblePriorities.length;
  const priorityRangeLabel = priorityRangeEnd === priorityStartIndex + 1
    ? `${priorityRangeEnd} of ${focusAssignments.length}`
    : `${priorityStartIndex + 1}–${priorityRangeEnd} of ${focusAssignments.length}`;
  const prioritySwipeRef = useRef<{ pointerId: number; x: number; y: number; captured: boolean } | null>(null);
  const suppressSwipeClickRef = useRef(false);

  function handlePriorityPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    suppressSwipeClickRef.current = false;
    if (event.pointerType === "mouse" || event.isPrimary === false || event.button !== 0) {
      prioritySwipeRef.current = null;
      return;
    }

    prioritySwipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, captured: false };
  }

  function handlePriorityPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = prioritySwipeRef.current;
    if (!start || start.captured || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < PRIORITY_SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (typeof event.currentTarget.setPointerCapture !== "function") return;

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      start.captured = true;
    } catch {
      // Pointer capture is unavailable in some DOM implementations.
    }
  }

  function handlePriorityPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = prioritySwipeRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    prioritySwipeRef.current = null;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < PRIORITY_SWIPE_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    suppressSwipeClickRef.current = true;
    shiftPriorityPage(deltaX < 0 ? 1 : -1);
  }

  function shiftPriorityPage(direction: number) {
    setPriorityState((current) => {
      const page = current.sequence === assignmentSequence ? current.page : 0;
      return {
        sequence: assignmentSequence,
        page: Math.max(0, Math.min(priorityPageCount - 1, page + direction)),
      };
    });
  }

  function handlePriorityClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressSwipeClickRef.current || event.detail === 0) return;
    suppressSwipeClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleAskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!submittedQuestion || chatBusy) return;

    const conversationId = chatMessages.find((message) => message.conversationId)?.conversationId;
    const accepted = chatMessages.length > 0 && onContinueAssistant
      ? onContinueAssistant(submittedQuestion, conversationId)
      : onAskAssistant(submittedQuestion);
    if (accepted === false) return;
    setChatOpen(true);
    setQuestion("");
  }

  return (
    <section ref={shell} className="dashboard-summary dashboard-study-brief" aria-labelledby="dashboard-summary-title">
      <svg className="dashboard-study-outline" aria-hidden="true"><path ref={outline} /></svg>
      <div className="dashboard-study-summary">
        <div className="dashboard-study-heading">
          <span className="dashboard-study-sparkle"><Sparkles size={18} aria-hidden="true" /></span>
          <span className="dashboard-study-sender">Edu AI</span>
          <span className="dashboard-study-sample">Sample</span>
        </div>
        <h2 id="dashboard-summary-title" className="dashboard-study-title">Your study summary</h2>
        <p className="dashboard-study-lead">
          <span className="dashboard-study-copy-reserve" aria-hidden="true">{STUDY_SUMMARY}</span>
          <span className="dashboard-study-copy-animated" aria-hidden="true">
            {STUDY_SUMMARY.slice(0, summaryCharacters)}
            {summaryCharacters < STUDY_SUMMARY.length && <span className="dashboard-study-caret" />}
          </span>
          <span className="dashboard-study-screen-reader-copy">{STUDY_SUMMARY}</span>
        </p>
        <div ref={chatRegion} id="dashboard-study-chat" className="dashboard-study-chat-region" inert={!chatExpanded} aria-hidden={!chatExpanded}>
          <div ref={chatLog} className="dashboard-study-chat-log" role="log" aria-label="Conversation with Edu AI" aria-live="polite">
            {chatMessages.map((message) => (
              <div className="dashboard-study-chat-turn" key={message.id}>
                <div className="dashboard-study-chat-message dashboard-study-chat-user"><span className="sr-only">You: </span>{message.question}</div>
                <div className="dashboard-study-chat-message dashboard-study-chat-assistant">
                  <span className="dashboard-study-chat-label">Edu AI</span>
                  {message.result ? <>
                    {message.result.answer.blocks.map((block, index) => <p key={index}>{block.text}</p>)}
                    {message.result.citations.length > 0 && <details><summary>Sources</summary>{message.result.citations.map((citation) => <p key={citation.id}><strong>{citation.label}</strong><br />{citation.text}</p>)}</details>}
                    {message.result.proposalId && <button type="button" className="text-button" onClick={() => onOpenAssistant(undefined, message.conversationId, message.result?.proposalId ?? undefined)}>Review proposed changes in assistant</button>}
                  </> : message.error ? <p role="alert">{message.error}</p> : <p className="dashboard-study-chat-thinking">Thinking…</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="dashboard-study-footer">
          <form className="dashboard-study-ask" onSubmit={handleAskSubmit}>
            <div className="dashboard-study-ask-field">
              <input
                className={`dashboard-study-ask-input${showAskSuggestion ? " dashboard-study-ask-input--suggestion" : ""}`}
                type="text"
                aria-label="Ask Edu AI"
                placeholder={askPlaceholder}
                maxLength={8000}
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                onFocus={() => setAskFocused(true)}
                onBlur={() => setAskFocused(false)}
              />
              {showAskSuggestion && (
                <span className="dashboard-study-ask-suggestion" aria-hidden="true">
                  <span className="dashboard-study-ask-suggestion-text">{askPlaceholder}</span>
                  <span className="dashboard-study-ask-caret" />
                </span>
              )}
            </div>
            <button className="dashboard-study-ask-submit" type="submit" aria-label="Send question" disabled={!question.trim() || chatBusy}>
              <ArrowUp size={17} aria-hidden="true" />
            </button>
          </form>
          <button
            className="dashboard-study-open"
            type="button"
            title="Open assistant"
            aria-label="Open assistant"
            onClick={() => onOpenAssistant(question.trim())}
          >
            <MessageSquare size={18} aria-hidden="true" />
          </button>
        </div>
        {showChatToggle && <button
          className="dashboard-study-chat-toggle"
          type="button"
          aria-label={chatExpanded ? "Collapse chat" : "Expand chat"}
          title={chatExpanded ? "Collapse chat" : "Expand chat"}
          aria-expanded={chatExpanded}
          aria-controls="dashboard-study-chat"
          data-reduced-motion={shouldReduceMotion}
          onClick={() => setChatOpen(!chatExpanded)}
        ><ChevronUp size={17} aria-hidden="true" /></button>}
      </div>

      <aside className="dashboard-focus" aria-labelledby="dashboard-priorities-title">
        <div className="dashboard-focus-heading">
          <h2 id="dashboard-priorities-title">Your priorities</h2>
          <div className="dashboard-focus-counts" aria-label="Assignment status summary">
            <span><i className="dashboard-dot overdue" />{overdueCount} overdue</span>
            <span><i className="dashboard-dot today" />{dueTodayCount} due today</span>
            <span><i className="dashboard-dot done" />{completedThisWeek} done this week</span>
          </div>
        </div>
        {focusAssignments.length ? (
          <>
            <div
              className="dashboard-focus-viewport"
              onPointerDown={handlePriorityPointerDown}
              onPointerMove={handlePriorityPointerMove}
              onPointerUp={handlePriorityPointerUp}
              onPointerCancel={() => { prioritySwipeRef.current = null; }}
              onClickCapture={handlePriorityClickCapture}
            >
              <ol
                id="dashboard-priority-list"
                className="dashboard-focus-list"
                start={priorityStartIndex + 1}
                aria-label="Prioritized assignments"
              >
                {visiblePriorities.map((assignment, index) => {
                  const globalIndex = priorityStartIndex + index;
                  return (
                    <li
                      key={assignment.id}
                      className={globalIndex === 0 ? "dashboard-focus-priority-first" : undefined}
                      aria-posinset={globalIndex + 1}
                      aria-setsize={focusAssignments.length}
                    >
                      <button type="button" className="dashboard-focus-item" onClick={() => onSelectAssignment(assignment)}>
                        <span className="dashboard-focus-number">{String(globalIndex + 1).padStart(2, "0")}</span>
                        <span className="dashboard-focus-label">
                          <strong>{assignment.title}</strong>
                          <small>{courseCodeFor(assignment.courseId)} · {assignment.dateKey ? assignment.due : "No due date"}</small>
                          <span className="dashboard-focus-rationale">{priorityAdvice(assignment)}</span>
                        </span>
                        {renderStatusBadge(assignment.status)}
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
            {focusAssignments.length > PRIORITIES_PER_PAGE && (
              <div className="dashboard-focus-pagination" role="group" aria-label="Priority pages">
                <button
                  type="button"
                  className="dashboard-focus-page-button"
                  aria-label="Previous priorities"
                  aria-controls="dashboard-priority-list"
                  disabled={priorityPage === 0}
                  onClick={() => shiftPriorityPage(-1)}
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="dashboard-focus-range" aria-live="polite" aria-atomic="true">
                  {priorityRangeLabel}
                </span>
                <button
                  type="button"
                  className="dashboard-focus-page-button"
                  aria-label="Next priorities"
                  aria-controls="dashboard-priority-list"
                  disabled={priorityPage >= priorityPageCount - 1}
                  onClick={() => shiftPriorityPage(1)}
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="dashboard-focus-empty">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>{courseCount ? "You’re all caught up." : "Let’s get your semester set up."}</strong>
            <p>{courseCount ? "No outstanding assignments. Make room for a little review—or a break." : "Add a class or import a syllabus to see your next steps here."}</p>
            <button className="text-button" type="button" onClick={courseCount ? onAddAssignment : onAddClass}>
              {courseCount ? "Add an assignment" : "Add your first class"}<ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
    </section>
  );
}
