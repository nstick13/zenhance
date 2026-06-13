"use client";

import { useEffect, useState } from "react";

const FLAG = "zenhance_onboarded";

export function OnboardingBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(FLAG)) {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(FLAG, "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between bg-fuchsia-500/10 px-6 py-3 text-sm text-fuchsia-200 backdrop-blur-sm">
      <span>
        Welcome to Zenhance. Load the demo org to see it in action, or build your own.
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="ml-4 shrink-0 text-fuchsia-400 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
