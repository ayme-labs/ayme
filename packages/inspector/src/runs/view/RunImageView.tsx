import type { RunImage } from "../domain/run";

/**
 * An image a run returned: a thumbnail that opens full size, and what it
 * shows. A run from before a reload has no image left to show.
 */
export function RunImageView({
  image,
  onOpen,
}: {
  image: RunImage;
  /** Opens the image, given its data URL, full size. */
  onOpen: (src: string) => void;
}) {
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
          onClick={() => onOpen(image.src!)}
        >
          <img
            src={image.src}
            alt={image.description}
            className="block max-h-40 max-w-full object-contain"
          />
        </button>
      )}
      <figcaption className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {image.description}
        {image.savedTo !== undefined && (
          <>
            , saved to <span className="font-mono">{image.savedTo}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}
