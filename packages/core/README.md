# kikori core

Source shared by the packages in this repository. It is not published on its own: each package compiles these files into its own output.

It holds only what does not depend on a platform:

- the catalogue of WCAG success criteria (`criteria.ts`),
- the types of findings and check results (`types.ts`),
- the per-criterion summary and the way judgments are applied (`summary.ts`),
- the language of messages (`i18n.ts`),
- the core version (`version.ts`).

## Rules

- Nothing here may import a browser, a device driver or anything else that belongs to one platform.
- Lists that depend on what a platform can gather evidence for, such as the criteria that always need a judgment, stay in the packages. The core takes them as arguments (`PlatformRules`).
- Raise `CORE_VERSION` when the catalogue, the statuses or the way judgments are applied changes. Every package reports it in its results, so a result shows which core produced it. When the behaviour of the core changes, release the packages in the same cycle.
