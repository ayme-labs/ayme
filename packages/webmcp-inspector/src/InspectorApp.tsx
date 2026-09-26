import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@ayme-dev/design-system/components/badge";
import { Button } from "@ayme-dev/design-system/components/button";
import { cn } from "@ayme-dev/design-system/lib/utils";

import { AymeMark } from "./AymeMark";
import { Fab } from "./Fab";
import { ModelViewTab } from "./ModelViewTab";
import { PageObjectsTab } from "./PageObjectsTab";
import { listPomClasses } from "./pomModel";
import { PortalContainerContext } from "./portal";
import { RunsTab } from "./RunsTab";
import { ThemeMenu } from "./ThemeMenu";
import type { FieldValue, FieldValues } from "./toolArguments";
import { useInspector } from "./useInspector";
import { useInspectorTrace } from "./useInspectorTrace";
import { useRuns, type Run } from "./useRuns";
import { useTheme } from "./useTheme";

const tabs = [
  { id: "page-objects", label: "Page objects" },
  { id: "model-view", label: "Model view" },
  { id: "runs", label: "Runs" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function InspectorApp() {
  const inspector = useInspector();
  const { refreshPageState, registeredPoms, activeTools, clearPreview } =
    inspector;
  const trace = useInspectorTrace();
  const theme = useTheme();
  const onRunSettled = useCallback(
    () => void refreshPageState(),
    [refreshPageState]
  );
  const { runs, invoke, clear } = useRuns({ onSettled: onRunSettled });

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<TabId>("page-objects");
  const [formValues, setFormValues] = useState<Record<string, FieldValues>>({});
  const setFieldValue = useCallback(
    (toolName: string, parameterName: string, value: FieldValue) =>
      setFormValues((current) => ({
        ...current,
        [toolName]: { ...current[toolName], [parameterName]: value },
      })),
    []
  );

  const pomClasses = useMemo(
    () => listPomClasses(registeredPoms),
    [registeredPoms]
  );
  const lastRunByTool = useMemo(() => {
    const lastRuns = new Map<string, Run>();
    for (const run of runs)
      if (!lastRuns.has(run.toolName)) lastRuns.set(run.toolName, run);
    return lastRuns;
  }, [runs]);

  const [collapsed, setCollapsed] = useState(false);
  const fabButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? fabButton : collapseButton).current?.focus();
  }, [collapsed]);
  const setCollapsedAndFocus = (next: boolean) => {
    moveFocus.current = true;
    if (next) clearPreview();
    setCollapsed(next);
  };

  const id = useId();
  const tabId = (tab: TabId) => `${id}-${tab}-tab`;
  const panelId = (tab: TabId) => `${id}-${tab}-panel`;

  return (
    <div
      data-ayme-inspector-root
      className={cn(
        "font-sans text-sm text-foreground antialiased",
        theme.dark ? "dark scheme-dark" : "scheme-light"
      )}
    >
      <PortalContainerContext value={portalContainer}>
        {collapsed ? (
          <Fab ref={fabButton} onOpen={() => setCollapsedAndFocus(false)} />
        ) : (
          <aside
            aria-label="Ayme Inspector"
            className="pointer-events-auto absolute top-4 right-4 flex max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-lg max-sm:top-auto max-sm:right-2 max-sm:bottom-2 max-sm:left-2 max-sm:max-h-[60vh] max-sm:w-auto"
          >
            <header className="flex items-center gap-2 border-b p-3">
              <AymeMark className="size-6 shrink-0" />
              <h2 className="text-base font-semibold">Ayme Inspector</h2>
              <Badge variant="outline">{registeredPoms.length} POMs</Badge>
              <div className="ml-auto flex items-center gap-1">
                <ThemeMenu
                  preference={theme.preference}
                  onChange={theme.setPreference}
                />
                <Button
                  ref={collapseButton}
                  size="icon"
                  variant="ghost"
                  aria-label="Collapse inspector"
                  aria-expanded
                  onClick={() => setCollapsedAndFocus(true)}
                >
                  −
                </Button>
              </div>
            </header>
            <div
              role="tablist"
              aria-label="Inspector views"
              className="flex gap-1 border-b px-3 py-2"
            >
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  id={tabId(tab.id)}
                  role="tab"
                  size="sm"
                  variant={activeTab === tab.id ? "secondary" : "ghost"}
                  aria-selected={activeTab === tab.id}
                  aria-controls={panelId(tab.id)}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </Button>
              ))}
            </div>
            <div
              id={panelId(activeTab)}
              role="tabpanel"
              aria-labelledby={tabId(activeTab)}
              className="overflow-auto p-3"
            >
              {activeTab === "page-objects" && (
                <PageObjectsTab
                  pomClasses={pomClasses}
                  highlight={inspector}
                  tools={{
                    activeTools,
                    formValues,
                    setFieldValue,
                    invoke: (toolName, args) => void invoke(toolName, args),
                    lastRunByTool,
                  }}
                />
              )}
              {activeTab === "model-view" && (
                <ModelViewTab
                  pageState={inspector.pageState}
                  refreshPageState={() => void refreshPageState()}
                  registeredPoms={registeredPoms}
                  activeTools={activeTools}
                />
              )}
              {activeTab === "runs" && (
                <RunsTab runs={runs} clearRuns={clear} trace={trace} />
              )}
            </div>
          </aside>
        )}
        <div
          ref={setPortalContainer}
          className="pointer-events-auto"
          data-ayme-inspector-portal
        />
      </PortalContainerContext>
    </div>
  );
}
