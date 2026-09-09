/** The Satoshi's Council seal — the faceless hooded Chair inside a gold ring,
 *  from the brand artwork. Transparent PNG, so the gold sits on any dark
 *  surface. `figure` swaps in the hood-only crop (no arched type) for the
 *  tightest sizes. */
export function Crest({
  size = 24,
  className = "",
  title = "Satoshi's Council",
  figure = false,
}: {
  size?: number;
  className?: string;
  title?: string;
  figure?: boolean;
}) {
  return (
    <img
      src={figure ? "/seal-figure.png" : "/seal.png"}
      width={size}
      height={size}
      className={className}
      alt={title}
      draggable={false}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
