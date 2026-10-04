import { useState, type ComponentProps } from "react";

import { WhatTheModelSeesView } from "../view/WhatTheModelSeesView";

/**
 * "What the model sees": the Page Object definitions and tool schemas an
 * agent receives, syntax-highlighted. It starts collapsed.
 */
export function WhatTheModelSees(
  props: Omit<ComponentProps<typeof WhatTheModelSeesView>, "open" | "onToggle">
) {
  const [open, setOpen] = useState(false);
  return (
    <WhatTheModelSeesView
      {...props}
      open={open}
      onToggle={() => setOpen((current) => !current)}
    />
  );
}
