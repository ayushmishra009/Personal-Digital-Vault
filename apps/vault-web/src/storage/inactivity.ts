export interface InactivityTracker {
  reset(): void;
  dispose(): void;
}

/**
 * Monitors user interaction and triggers an auto-lock callback after inactivity.
 */
export function setupInactivityTracker(
  timeoutMs: number,
  onTimeout: () => void,
): InactivityTracker {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  };

  const events = [
    "mousemove",
    "keydown",
    "pointerdown",
    "scroll",
    "touchstart",
  ];
  const listener = () => reset();

  if (typeof window !== "undefined") {
    for (const ev of events) {
      window.addEventListener(ev, listener, { passive: true });
    }
  }

  // Start initial timer
  reset();

  return {
    reset,
    dispose: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (typeof window !== "undefined") {
        for (const ev of events) {
          window.removeEventListener(ev, listener);
        }
      }
    },
  };
}
