---
status: superseded by ADR-0033
---

# Coding agents connect through Ayme's own MCP server, one per agent, each paired with one tab, and page tools are always reachable through fixed fallback tools

The WebMCP local relay runs one server per machine, and the first relay started decides the settings for every agent after it. That made several agents, several worktrees and several agent products on one machine conflict, which is the normal way developers work with coding agents. We considered Playwright MCP's WebMCP tools instead and rejected them: attaching to the developer's own browser needs its extension, and agents would tend to use Playwright's generic tools over Ayme's. So each coding agent runs its own Ayme MCP server, which pairs with one tab through a link the agent asks for and does not manage a browser. Page tools are registered dynamically, but only Claude Code follows tool-list changes (Codex CLI and Cursor CLI do not, measured 2026-10-04), so two fixed fallback tools, one that lists the page's tools and one that calls any of them by name, keep every page tool reachable. The cost is one more package to publish and a channel between server and page that Ayme now owns; WebMCP publication stays for in-browser agents.
