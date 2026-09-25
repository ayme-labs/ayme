import { joinAdjacentText } from "./joinAdjacentText";
import type {
  ProjectedStructuralNode,
  ProjectedStructuralNodeForest,
} from "./StructuralProjection";

const STATUS_TOKEN: Partial<
  Record<NonNullable<ProjectedStructuralNode["status"]>["kind"], string>
> = {
  updated: "<changed>",
  added: "<added>",
  removed: "<removed>",
};

/**
 * The compact text renderer: the notation `get_page_context` and the Change
 * Record use. Adjacent text children are joined into one text.
 */
export function renderCompactStructuralNodeForest(
  forest: ProjectedStructuralNodeForest
): string {
  return joinAdjacentText(forest.roots)
    .map((node) => renderNode(node, 0))
    .join("\n");
}

function renderNode(
  node: ProjectedStructuralNode | string,
  depth: number
): string {
  if (typeof node === "string")
    return `${indent(depth)}- text: ${formatScalar(node)}`;
  const statusToken =
    node.status === undefined ? undefined : STATUS_TOKEN[node.status.kind];
  if (node.compact) {
    const summary = [
      statusToken,
      node.identityToken === undefined ? undefined : `[${node.identityToken}]`,
    ]
      .filter((value): value is string => value !== undefined)
      .join(" ");
    return `${indent(depth)}-${summary === "" ? "" : ` ${summary}`}`;
  }

  const header = [...node.prefixes, statusToken, formatNodeHeader(node)]
    .filter((value): value is string => value !== undefined && value !== "")
    .join(" ");
  const children = joinAdjacentText(node.children);
  const inlineText = children.filter(
    (child): child is string => typeof child === "string"
  );
  const hasNodeChildren = children.some((child) => typeof child !== "string");
  const block =
    node.properties.length > 0 || hasNodeChildren || inlineText.length > 1;
  if (!block && inlineText.length === 1)
    return `${indent(depth)}- ${header}: ${formatScalar(inlineText[0]!)}`;

  const lines = [`${indent(depth)}- ${header}${block ? ":" : ""}`];
  for (const property of node.properties)
    lines.push(
      `${indent(depth + 1)}- /${property.label}: ${formatProperty(property.value)}`
    );
  for (const child of children) lines.push(renderNode(child, depth + 1));
  return lines.join("\n");
}

function formatNodeHeader(node: ProjectedStructuralNode): string {
  const segments: string[] =
    node.identityToken === undefined ? [] : [`[${node.identityToken}]`];
  if (node.role !== "generic") segments.push(node.role);
  if (node.name) segments.push(`"${escapeQuoted(node.name)}"`);
  if (node.state.checked === true) segments.push("[checked]");
  if (node.state.checked === "mixed") segments.push("[checked=mixed]");
  if (node.state.disabled) segments.push("[disabled]");
  if (node.state.expanded) segments.push("[expanded]");
  if (node.state.active) segments.push("[active]");
  if (node.state.selected) segments.push("[selected]");
  if (node.state.pressed === true) segments.push("[pressed]");
  if (node.state.pressed === "mixed") segments.push("[pressed=mixed]");
  if (node.state.level !== undefined)
    segments.push(`[level=${node.state.level}]`);
  if (node.cursorPointer) segments.push("[cursor=pointer]");
  return segments.join(" ");
}

function formatProperty(value: string | readonly string[]): string {
  return typeof value === "string"
    ? formatScalar(value)
    : JSON.stringify(value);
}

function indent(depth: number): string {
  return "  ".repeat(depth);
}

function formatScalar(value: string): string {
  if (value === "") return '""';
  if (/[:#[\]{},"'&*!?|<>%@`]/.test(value) || /^\s|\s$/.test(value))
    return `"${escapeQuoted(value)}"`;
  return value;
}

function escapeQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
