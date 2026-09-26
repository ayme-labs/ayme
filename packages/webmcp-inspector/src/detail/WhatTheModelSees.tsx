import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CodeIcon } from "lucide-react";
import { parse, render } from "sugar-high/core";
import * as json from "sugar-high/lang/json";
import * as typescript from "sugar-high/lang/typescript";

/** A tool's input schema, as an agent receives it. */
export type ToolSchema = { name: string; inputSchema: unknown };

/**
 * "What the model sees": the Page Object definitions and tool schemas an
 * agent receives, syntax-highlighted. It starts collapsed. The highlighter's
 * colours come from the --sh-* properties on the Inspector's root.
 */
export function WhatTheModelSees({
  definitions,
  schemas,
}: {
  /** Page Object definitions, as get_page_context renders them. */
  definitions?: string;
  schemas: readonly ToolSchema[];
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <section aria-label="What the model sees" className="mt-[18px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="mb-2 flex w-full items-center gap-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase hover:text-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3.5" aria-hidden />
        ) : (
          <ChevronRightIcon className="size-3.5" aria-hidden />
        )}
        <CodeIcon className="size-3.5" aria-hidden />
        What the model sees · {summary(definitions, schemas)}
      </button>
      {open && (
        <div id={contentId} className="grid gap-2.5">
          {definitions && (
            <Code
              code={definitions}
              language="typescript"
              label="Page object definitions"
            />
          )}
          {schemas.map((schema) => (
            <div key={schema.name} className="grid gap-1">
              <div className="font-mono text-[11.5px] font-semibold">
                {schema.name}
              </div>
              <Code
                code={JSON.stringify(schema.inputSchema, null, 2)}
                language="json"
                label={`${schema.name} input schema`}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const languages = { typescript, json };

function Code({
  code,
  language,
  label,
}: {
  code: string;
  language: keyof typeof languages;
  label: string;
}) {
  return (
    <pre
      aria-label={label}
      className="max-h-96 overflow-auto rounded-lg bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed"
    >
      {/* sugar-high escapes the code it renders. */}
      <code
        dangerouslySetInnerHTML={{
          __html: render(parse(code, languages[language])),
        }}
      />
    </pre>
  );
}

function summary(
  definitions: string | undefined,
  schemas: readonly ToolSchema[]
) {
  const parts: string[] = [];
  if (definitions) parts.push("definition");
  if (schemas.length > 0)
    parts.push(
      `${schemas.length} tool ${schemas.length === 1 ? "schema" : "schemas"}`
    );
  return parts.join(" and ") || "nothing";
}
