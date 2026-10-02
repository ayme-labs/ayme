import type { Locator } from "@playwright/test";

export type PomRootState = { present: boolean; available: boolean };

/**
 * Observe one POM root without scrolling or sending input.
 * Scroll reachability describes the current layout, not content a scroll
 * handler might create.
 */
export async function probePomRootState(
  locator: Locator
): Promise<PomRootState> {
  try {
    if ((await locator.count()) !== 1 || !(await locator.isVisible()))
      return { present: false, available: false };
    return await locator.evaluate((element) => {
      const absent = { present: false, available: false };
      type Rect = { left: number; right: number; top: number; bottom: number };
      type Scroll = { element: Element; x: number; y: number };
      type ScrollAlignment = "current" | "center" | "start" | "end";

      function parentElement(current: Element): Element | null {
        return (
          current.assignedSlot ??
          current.parentElement ??
          (current.getRootNode() as ShadowRoot).host ??
          null
        );
      }

      function contains(ancestor: Element, candidate: Element): boolean {
        for (
          let node: Element | null = candidate;
          node;
          node = parentElement(node)
        )
          if (node === ancestor) return true;
        return false;
      }

      function establishesContainingBlock(style: CSSStyleDeclaration): boolean {
        return (
          style.transform !== "none" ||
          style.perspective !== "none" ||
          style.filter !== "none" ||
          /layout|paint|strict|content/.test(style.contain) ||
          /transform|perspective|filter/.test(style.willChange)
        );
      }

      function layoutAncestors(current: Element) {
        const view = current.ownerDocument.defaultView!;
        const ancestors: Element[] = [];
        let node = current;
        while (true) {
          const position = view.getComputedStyle(node).position;
          let parent = parentElement(node);
          if (position === "fixed" || position === "absolute") {
            while (parent && parent !== current.ownerDocument.documentElement) {
              const style = view.getComputedStyle(parent);
              if (
                establishesContainingBlock(style) ||
                (position === "absolute" && style.position !== "static")
              )
                break;
              parent = parentElement(parent);
            }
            if (
              position === "fixed" &&
              (!parent ||
                !establishesContainingBlock(view.getComputedStyle(parent)))
            )
              return { ancestors, fixedToViewport: true };
          }
          if (!parent) return { ancestors, fixedToViewport: false };
          ancestors.push(parent);
          node = parent;
        }
      }

      function scrollDelta(
        start: number,
        end: number,
        portStart: number,
        portEnd: number,
        current: number,
        maximum: number,
        scrollable: boolean,
        scale: number,
        reverse: boolean,
        alignment: ScrollAlignment
      ): number {
        if (
          !scrollable ||
          maximum === 0 ||
          scale <= 0 ||
          alignment === "current"
        )
          return 0;

        const offset =
          alignment === "start"
            ? start - portStart
            : alignment === "end"
              ? end - portEnd
              : (start + end) / 2 - (portStart + portEnd) / 2;
        const desired = current + offset / scale;
        const next = Math.max(
          reverse ? -maximum : 0,
          Math.min(reverse ? 0 : maximum, desired)
        );
        return (current - next) * scale;
      }

      function projectIntoPort(
        rect: Rect,
        port: Rect,
        scroller: Element,
        overflowX: string,
        overflowY: string,
        scaleX: number,
        scaleY: number,
        alignment: ScrollAlignment
      ): Scroll {
        const style =
          scroller.ownerDocument.defaultView!.getComputedStyle(scroller);
        const reverseX =
          style.direction === "rtl" || style.writingMode === "vertical-rl";
        const x = scrollDelta(
          rect.left,
          rect.right,
          port.left,
          port.right,
          scroller.scrollLeft,
          Math.max(0, scroller.scrollWidth - scroller.clientWidth),
          /^(auto|scroll|overlay)$/.test(overflowX),
          scaleX,
          reverseX,
          alignment
        );
        const y = scrollDelta(
          rect.top,
          rect.bottom,
          port.top,
          port.bottom,
          scroller.scrollTop,
          Math.max(0, scroller.scrollHeight - scroller.clientHeight),
          /^(auto|scroll|overlay)$/.test(overflowY),
          scaleY,
          false,
          alignment
        );
        rect.left += x;
        rect.right += x;
        rect.top += y;
        rect.bottom += y;
        return { element: scroller, x, y };
      }

      function clip(
        rect: Rect,
        port: Rect,
        x: boolean,
        y: boolean
      ): Rect | undefined {
        const result = {
          left: x ? Math.max(rect.left, port.left) : rect.left,
          right: x ? Math.min(rect.right, port.right) : rect.right,
          top: y ? Math.max(rect.top, port.top) : rect.top,
          bottom: y ? Math.min(rect.bottom, port.bottom) : rect.bottom,
        };
        return result.right > result.left && result.bottom > result.top
          ? result
          : undefined;
      }

      // ponytail: rectangular px/% inset clips and collapsed basic shapes only;
      // other clip geometry needs browser support rather than a CSS shape parser.
      function clipBounds(current: Element): Rect | null | undefined {
        const style =
          current.ownerDocument.defaultView!.getComputedStyle(current);
        if (/^(?:circle|ellipse)\(0(?:px|%)?(?:\s|\))/.test(style.clipPath))
          return null;
        const inset = /^inset\(([^()]*)\)$/
          .exec(style.clipPath)?.[1]
          ?.split(" round ")[0];
        if (!inset) return;
        const values = inset.trim().split(/\s+/);
        if (!values.every((value) => /^-?[\d.]+(?:px|%)?$/.test(value))) return;
        const [top, right = top, bottom = top, left = right] = values;
        const box = current.getBoundingClientRect();
        const distance = (value: string, size: number, layoutSize: number) =>
          value.endsWith("%")
            ? (Number.parseFloat(value) * size) / 100
            : Number.parseFloat(value) * (layoutSize ? size / layoutSize : 1);
        const width = (current as HTMLElement).offsetWidth;
        const height = (current as HTMLElement).offsetHeight;
        return {
          left: box.left + distance(left!, box.width, width),
          right: box.right - distance(right!, box.width, width),
          top: box.top + distance(top!, box.height, height),
          bottom: box.bottom - distance(bottom!, box.height, height),
        };
      }

      function hitElements(
        root: Document | ShadowRoot,
        x: number,
        y: number
      ): Element[] {
        return root
          .elementsFromPoint(x, y)
          .flatMap((hit) =>
            hit.getRootNode() === root && hit.shadowRoot
              ? [...hitElements(hit.shadowRoot, x, y), hit]
              : [hit]
          );
      }

      function projectedOffset(current: Element, scrolls: readonly Scroll[]) {
        const { ancestors, fixedToViewport } = layoutAncestors(current);
        let left = 0;
        let top = 0;
        for (const scroll of scrolls) {
          if (scroll.element === current || !ancestors.includes(scroll.element))
            continue;
          if (
            fixedToViewport &&
            scroll.element === current.ownerDocument.scrollingElement
          )
            continue;
          left += scroll.x;
          top += scroll.y;
        }
        return { left, top };
      }

      function zIndex(style: CSSStyleDeclaration): number {
        if (style.zIndex === "auto") return 0;
        const value = Number(style.zIndex);
        return Number.isFinite(value) ? value : 0;
      }

      function projectedSiblingOccluders(
        current: Element,
        scrolls: readonly Scroll[]
      ): { bounds: DOMRect; left: number; top: number }[] {
        const view = current.ownerDocument.defaultView!;
        const NodeCtor = view.Node;
        const occluders: { bounds: DOMRect; left: number; top: number }[] = [];

        // ponytail: sibling branch boxes cover the practical moving-overlay
        // case without reimplementing the browser's stacking algorithm.
        for (let branch = current; ;) {
          const parent = parentElement(branch);
          if (!parent) break;
          const branchStyle = view.getComputedStyle(branch);
          const branchZ = zIndex(branchStyle);
          for (const sibling of parent.children) {
            if (sibling === branch) continue;
            const style = view.getComputedStyle(sibling);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              style.pointerEvents === "none"
            )
              continue;
            const siblingZ = zIndex(style);
            const follows = Boolean(
              branch.compareDocumentPosition(sibling) &
              NodeCtor.DOCUMENT_POSITION_FOLLOWING
            );
            if (siblingZ < branchZ || (siblingZ === branchZ && !follows))
              continue;
            const { left, top } = projectedOffset(sibling, scrolls);
            if (left === 0 && top === 0) continue;
            occluders.push({
              bounds: sibling.getBoundingClientRect(),
              left,
              top,
            });
          }
          branch = parent;
        }
        return occluders;
      }

      function containsPoint(
        bounds: { left: number; right: number; top: number; bottom: number },
        left: number,
        top: number,
        x: number,
        y: number
      ) {
        return (
          x >= bounds.left + left &&
          x < bounds.right + left &&
          y >= bounds.top + top &&
          y < bounds.bottom + top
        );
      }

      function hasUnobstructedPoint(
        current: Element,
        rect: Rect,
        scrolls: readonly Scroll[]
      ): boolean {
        const projectedOccluders = projectedSiblingOccluders(current, scrolls);
        // ponytail: bounded hit sampling, not pixel-perfect occlusion.
        for (const horizontal of [0.05, 0.5, 0.95]) {
          for (const vertical of [0.05, 0.5, 0.95]) {
            const x = rect.left + (rect.right - rect.left) * horizontal;
            const y = rect.top + (rect.bottom - rect.top) * vertical;
            if (
              projectedOccluders.some(({ bounds, left, top }) =>
                containsPoint(bounds, left, top, x, y)
              )
            )
              continue;
            for (const hit of hitElements(current.ownerDocument, x, y)) {
              if (contains(current, hit)) return true;
              // Ancestors are evidence only for a simulated scroll destination,
              // never proof that the current root itself is exposed.
              if (
                scrolls.some(({ x, y }) => x !== 0 || y !== 0) &&
                contains(hit, current)
              )
                return true;
              const { left, top } = projectedOffset(hit, scrolls);
              const bounds = hit.getBoundingClientRect();
              if (containsPoint(bounds, left, top, x, y)) break;
            }
          }
        }
        return false;
      }

      if (!element.isConnected) return absent;
      const document = element.ownerDocument;
      const view = document.defaultView;
      if (!view) return absent;
      let blocked = false;
      let modals: Element[];
      try {
        modals = [...document.querySelectorAll(":modal")];
      } catch {
        modals = [];
      }
      if (
        modals.length &&
        !modals.some(
          (modal) => contains(modal, element) || contains(element, modal)
        )
      )
        blocked = true;
      for (
        let node: Element | null = element;
        node;
        node = parentElement(node)
      ) {
        if (node.hasAttribute("inert")) {
          blocked = true;
          break;
        }
        // A modal escapes inherited inertness, but not its own inert attribute.
        if (modals.includes(node)) break;
      }

      const htmlStyle = view.getComputedStyle(document.documentElement);
      const bodyStyle = document.body && view.getComputedStyle(document.body);
      const viewport: Rect = {
        left: 0,
        top: 0,
        right: document.documentElement.clientWidth,
        bottom: document.documentElement.clientHeight,
      };

      let present = false;
      const rootRects = [...element.getClientRects()];
      const candidates = rootRects.length
        ? rootRects.map((bounds) => ({ source: element, bounds }))
        : [...element.querySelectorAll("*")].flatMap((source) => {
            const style = view.getComputedStyle(source);
            if (
              style.visibility === "hidden" ||
              style.visibility === "collapse"
            )
              return [];
            return [...source.getClientRects()].map((bounds) => ({
              source,
              bounds,
            }));
          });
      for (const { source, bounds } of candidates) {
        const { ancestors, fixedToViewport } = layoutAncestors(source);
        for (const alignment of [
          "current",
          "center",
          "start",
          "end",
        ] as const satisfies readonly ScrollAlignment[]) {
          let rect: Rect | undefined = {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
          };
          const ownClip = clipBounds(source);
          if (ownClip === null) continue;
          if (ownClip) rect = clip(rect, ownClip, true, true);
          if (!rect) continue;
          const scrolls: Scroll[] = [];
          for (const ancestor of ancestors) {
            if (ancestor === document.documentElement) break;
            if (
              ancestor === document.body &&
              htmlStyle.overflowX === "visible" &&
              htmlStyle.overflowY === "visible"
            )
              continue;
            const style = view.getComputedStyle(ancestor);
            const box = ancestor.getBoundingClientRect();
            const width = (ancestor as HTMLElement).offsetWidth || box.width;
            const height = (ancestor as HTMLElement).offsetHeight || box.height;
            const scaleX = width ? box.width / width : 1;
            const scaleY = height ? box.height / height : 1;
            const port = {
              left: box.left + ancestor.clientLeft * scaleX,
              top: box.top + ancestor.clientTop * scaleY,
              right:
                box.left +
                (ancestor.clientLeft + ancestor.clientWidth) * scaleX,
              bottom:
                box.top + (ancestor.clientTop + ancestor.clientHeight) * scaleY,
            };
            const scroll = projectIntoPort(
              rect,
              port,
              ancestor,
              style.overflowX,
              style.overflowY,
              scaleX,
              scaleY,
              alignment
            );
            scrolls.push(scroll);
            rect = clip(
              rect,
              port,
              style.overflowX !== "visible",
              style.overflowY !== "visible"
            );
            if (!rect) break;
            const ancestorClip = clipBounds(ancestor);
            if (ancestorClip === null) {
              rect = undefined;
              break;
            }
            if (ancestorClip) rect = clip(rect, ancestorClip, true, true);
            if (!rect) break;
          }
          if (!rect) continue;

          const scroller = document.scrollingElement;
          if (scroller && !fixedToViewport) {
            const overflowX =
              htmlStyle.overflowX === "visible"
                ? (bodyStyle?.overflowX ?? "visible")
                : htmlStyle.overflowX;
            const overflowY =
              htmlStyle.overflowY === "visible"
                ? (bodyStyle?.overflowY ?? "visible")
                : htmlStyle.overflowY;
            scrolls.push(
              projectIntoPort(
                rect,
                viewport,
                scroller,
                overflowX === "visible" ? "auto" : overflowX,
                overflowY === "visible" ? "auto" : overflowY,
                1,
                1,
                alignment
              )
            );
          }
          rect = clip(rect, viewport, true, true);
          if (!rect) continue;
          present = true;
          if (!blocked && hasUnobstructedPoint(element, rect, scrolls))
            return { present: true, available: true };
        }
      }
      return { present, available: false };
    });
  } catch {
    return { present: false, available: false };
  }
}
