# Release-quality performance comparison

Measured on 2026-07-27 with Windows 11 10.0.26200 (x64), Intel Core i7-12700K,
31.8 GB RAM, Node 24.18.0, and Electron 43.0.0. The baseline is commit
`64806db4cc924d37673d5125fecc3dfac022390c`. Both versions used the same generated
fixtures, a fresh Electron `userData` directory, and disposable document copies.
Times are wall-clock milliseconds; negative change is faster.

| Scenario                       | Operation             | Baseline (ms) | Current (ms) |  Change |
| ------------------------------ | --------------------- | ------------: | -----------: | ------: |
| 1 MB prose, source             | Open                  |       1,201.8 |      1,940.1 |  +61.4% |
| 1 MB prose, source             | Input acknowledgement |         164.6 |         48.9 |  -70.3% |
| 1 MB prose, source             | Switch to visual mode |      22,500.0 |     19,397.7 |  -13.8% |
| 1 MB prose, source             | Save                  |         123.0 |        117.7 |   -4.3% |
| 5 MB prose, source             | Open                  |       1,325.3 |      1,120.0 |  -15.5% |
| 5 MB prose, source             | Input acknowledgement |         325.2 |        188.3 |  -42.1% |
| 5 MB prose, source             | Save                  |         223.9 |        220.3 |   -1.6% |
| 30,000-item list, source       | Open                  |       1,784.0 |      1,192.7 |  -33.1% |
| 30,000-item list, source       | Input acknowledgement |         128.8 |         62.0 |  -51.9% |
| 30,000-item list, source       | Save                  |         231.9 |        116.6 |  -49.7% |
| 1,000 × 16 table, visual       | Open                  |       7,157.2 |      6,998.3 |   -2.2% |
| 1,200 code blocks, visual      | Open                  |       2,253.6 |      2,750.4 |  +22.0% |
| 500 Mermaid blocks, visual     | Open                  |       1,240.8 |      2,986.8 | +140.7% |
| 1 MB document / long-list tabs | Switch tab            |         172.7 |         93.5 |  -45.9% |

The data intentionally retains regressions instead of replacing them with a
qualitative claim. The final run regressed in the 1 MB cold-open, code-block visual
open, and Mermaid visual-open samples, while input acknowledgement, tab switching,
5 MB opening, and long-list opening improved. A 1 MB source-to-visual conversion
still takes about 19.4 seconds and the large visual table still takes about 7.0
seconds on this machine; these remain known limits of full visual-mode parsing and
DOM construction.

Raw reports: [`baseline.json`](baseline.json) and [`after.json`](after.json).
