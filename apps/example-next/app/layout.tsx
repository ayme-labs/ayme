import type { ReactNode } from "react";
import AymeRuntime from "./ayme-runtime";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AymeRuntime>{children}</AymeRuntime>
      </body>
    </html>
  );
}
