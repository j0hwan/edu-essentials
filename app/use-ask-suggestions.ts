import { useEffect, useState } from "react";

export const ASK_SUGGESTIONS = [
  "Help me plan my week",
  "What should I work on next",
  "Break down this assignment",
  "Make me a study schedule",
  "Help me prepare for an exam",
] as const;

const TYPE_DELAY_MS = 80;
const HOLD_DELAY_MS = 2250;
const DELETE_DELAY_MS = 35;
const NEXT_SUGGESTION_DELAY_MS = 350;
const INITIAL_PLACEHOLDER = "Ask Edu AI…";

type AnimationState = {
  suggestionIndex: number;
  visibleCharacters: number;
  phase: "intro" | "typing" | "deleting";
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
    visibleCharacters: INITIAL_PLACEHOLDER.length,
    phase: "intro",
  });

  useEffect(() => {
    if (!active || paused || reducedMotion || typeof window === "undefined") return;

    const suggestion = animation.phase === "intro"
      ? INITIAL_PLACEHOLDER
      : ASK_SUGGESTIONS[animation.suggestionIndex];
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
        suggestionIndex: current.phase === "intro" ? 0 : (current.suggestionIndex + 1) % ASK_SUGGESTIONS.length,
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

  if (!active || paused || reducedMotion) return INITIAL_PLACEHOLDER;
  const text = animation.phase === "intro" ? INITIAL_PLACEHOLDER : ASK_SUGGESTIONS[animation.suggestionIndex];
  return text.slice(0, animation.visibleCharacters);
}
