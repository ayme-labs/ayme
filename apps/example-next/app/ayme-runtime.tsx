"use client";

import type { ReactNode } from "react";
import { AymeProvider } from "@ayme-dev/react";

/** The app's Ayme runtime. The root layout owns it, so every page runs it. */
export default function AymeRuntime({ children }: { children: ReactNode }) {
  return (
    <AymeProvider
      webMCP={{ enabled: true }}
      inspector={process.env.NODE_ENV === "development"}
    >
      {children}
    </AymeProvider>
  );
}
