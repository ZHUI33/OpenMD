# OpenMD release performance benchmarks

Generate deterministic fixtures with:

```sh
pnpm benchmark:fixtures
```

The fixture set covers 1 MB and 5 MB prose documents, a 30,000-item list, a
1,000-row × 16-column table, 1,200 code blocks, and 500 Mermaid diagrams. Run the desktop
benchmark after `pnpm build`:

```sh
pnpm benchmark -- --label after --output benchmarks/results/after.json
```

Measurements use a fresh Electron `userData` directory and a disposable copy of
each fixture. Results record launch/open, input acknowledgement, save completion,
source-to-visual mode switching, and tab switching in milliseconds. This is a
repeatable engineering benchmark, not a claim about every hardware configuration.
The checked-in release comparison and raw measurements are in
[`results/comparison.md`](results/comparison.md).
