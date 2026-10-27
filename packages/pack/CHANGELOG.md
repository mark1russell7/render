# Changelog

## 0.1.3

- The code moved to `@mark1russell7/packing`, with its history. This package re-exports `@mark1russell7/packing` `^0.1.1`, so the API stays the same. It also gives `packShelf` and `ShelfOptions`, the new shelf packer. Use `@mark1russell7/packing` for new code.

## 0.1.2

- New: the sort order `input` keeps the order of the array of the caller. `packRows` then fills no gaps, so its rows read in that order. The default stays `height-desc`.

## 0.1.1

- New: `pushCascade` moves the rectangles that a placed rectangle overlaps, and the rectangles that those overlap in turn. The placed rectangle and each locked rectangle stay. (#8)
- New: `packingMetrics` measures a packing: the hull and its aspect, the rows, the raggedness, the utilization of the hull and the widest rectangle against the median. (#8)

## 0.1.0

- The first release: `pack`, `packRows`, `packSkyline`, the sort orders, `Rect` with `locked`, and `Vector`. (#7)
