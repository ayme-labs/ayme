import type { RunImage } from "../domain/run";

/** Opens a data URL's image full size in a new tab, which a data URL itself can't be. */
async function openFullSize(src: string) {
  const blob = await (await fetch(src)).blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  // Long enough for the tab to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * An image a run returned: a thumbnail that opens full size, and what it
 * shows. A run from before a reload has no image left to show.
 */
export function RunImageView({ image }: { image: RunImage }) {
  return (
    <figure aria-label="Image" className="m-0 flex flex-col gap-1">
      {image.src === undefined ? (
        <p className="m-0 rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground">
          Image not kept after reload.
        </p>
      ) : (
        <button
          type="button"
          title="Open full size"
          className="w-fit cursor-zoom-in overflow-hidden rounded-md border bg-muted p-0 hover:border-ring focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => void openFullSize(image.src!)}
        >
          <img
            src={image.src}
            alt={image.description}
            className="block max-h-40 max-w-full object-contain"
          />
        </button>
      )}
      <figcaption className="text-xs text-muted-foreground">
        {image.description}
      </figcaption>
    </figure>
  );
}
