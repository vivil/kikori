import type { Ring } from "./content";

/**
 * The comparison drawn as the face of a tree stump, seen from above.
 * Each growth ring is an arc whose length is the share of expected failures reported.
 * The picture is one image for assistive technology; the same numbers follow it as text.
 */
const RADII: Record<Ring["key"], number> = { judged: 158, automatic: 112, axe: 66 };
const ORDER: Ring["key"][] = ["axe", "automatic", "judged"];

export function Rings({ items, summary }: { items: Ring[]; summary: string }) {
  const byKey = Object.fromEntries(items.map((item) => [item.key, item])) as Record<Ring["key"], Ring>;
  return (
    <svg className="rings" viewBox="0 0 400 400" role="img" aria-label={summary}>
      {/* Bark, then the pale face of the cut wood. */}
      <circle cx="200" cy="200" r="194" className="rings__bark" />
      <circle cx="200" cy="200" r="183" className="rings__face" />
      {ORDER.map((key, index) => (
        <g key={key}>
          <circle cx="200" cy="200" r={RADII[key]} className="rings__track" />
          <circle
            cx="200"
            cy="200"
            r={RADII[key]}
            pathLength={100}
            className={`rings__arc rings__arc--${key}`}
            style={{ strokeDasharray: `${byKey[key].value} 100`, ["--v" as string]: byKey[key].value, ["--order" as string]: index }}
            transform="rotate(-90 200 200)"
          />
        </g>
      ))}
      <circle cx="200" cy="200" r="9" className="rings__pith" />
      {/* The axe cut, as in the logo: a wedge driven in from the bark. */}
      <path d="M304 38 L333 62 L236 174 Z" className="rings__cut" />
    </svg>
  );
}
