import { useEffect, useState } from "react";

export const ASK_SUGGESTIONS = [
  "Help me plan my week.",
  "What should I work on next?",
  "Break down this assignment.",
  "Make me a study schedule.",
  "Help me prepare for an exam.",
] as const;

const TYPE_DELAY_MS = 45;
const HOLD_DELAY_MS = 1400;
const DELETE_DELAY_MS = 25;
const NEXT_SUGGESTION_DELAY_MS = 350;

type AnimationState = {
  suggestionIndex: number;
  visibleCharacters: number;
  phase: "typing" | "deleting";
};

export function useAskSuggestions({
  active,
  paused,
  reducedMotion,
}: {
  active: boolean;
  paused: boolean;
  reducedMotion: boolean;
}) {
  const [animation, setAnimation] = useState<AnimationState>({
    suggestionIndex: 0,
    visibleCharacters: 0,
    phase: "typing",
  });

  useEffect(() => {
    if (!active || paused || reducedMotion || typeof window === "undefined") return;

    const suggestion = ASK_SUGGESTIONS[animation.suggestionIndex];
    const atEnd = animation.visibleCharacters >= suggestion.length;
    const timeout = window.setTimeout(() => {
      if (animation.phase === "typing") {
        if (atEnd) {
          setAnimation((current) => ({ ...current, phase: "deleting" }));
        } else {
          setAnimation((current) => ({ ...current, visibleCharacters: current.visibleCharacters + 1 }));
        }
        return;
      }

      if (animation.visibleCharacters > 0) {
        setAnimation((current) => ({ ...current, visibleCharacters: current.visibleCharacters - 1 }));
        return;
      }

      setAnimation((current) => ({
        suggestionIndex: (current.suggestionIndex + 1) % ASK_SUGGESTIONS.length,
        visibleCharacters: 0,
        phase: "typing",
      }));
    }, animation.phase === "typing"
      ? (atEnd ? HOLD_DELAY_MS : TYPE_DELAY_MS)
      : animation.visibleCharacters > 0
        ? DELETE_DELAY_MS
        : NEXT_SUGGESTION_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [active, animation, paused, reducedMotion]);

  if (!active || paused || reducedMotion) return "Ask Edu AI…";
  return ASK_SUGGESTIONS[animation.suggestionIndex].slice(0, animation.visibleCharacters);
}
