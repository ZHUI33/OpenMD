import { CrepeFeature } from '@milkdown/crepe'
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx } from '@milkdown/kit/core'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'

import { tableContextMenuPlugin } from './table-context-menu-plugin'
import { tableNavigationPlugin } from './table-navigation-plugin'

export const OPENMD_DEFAULT_TABLE_ROWS = 3
export const OPENMD_DEFAULT_TABLE_COLUMNS = 3

/** Spread this into Crepe's `features` option to enable its GFM table NodeView. */
export const openMdTableFeatures = {
  [CrepeFeature.Table]: true,
} satisfies Partial<Record<CrepeFeature, boolean>>

/** Register these after constructing Crepe and before calling `create()`. */
export const openMdTablePlugins = [tableNavigationPlugin, tableContextMenuPlugin]

export interface InsertGfmTableOptions {
  rows?: number
  columns?: number
}

export function normalizeTableSize({
  rows = OPENMD_DEFAULT_TABLE_ROWS,
  columns = OPENMD_DEFAULT_TABLE_COLUMNS,
}: InsertGfmTableOptions = {}): Required<InsertGfmTableOptions> {
  return {
    // A GFM table needs a header row and at least one data row.
    rows: Math.max(2, Math.trunc(rows)),
    columns: Math.max(1, Math.trunc(columns)),
  }
}

/** Insert a standard GFM table at the editor selection. */
export function insertGfmTable(ctx: Ctx, options?: InsertGfmTableOptions): boolean {
  const { rows, columns } = normalizeTableSize(options)
  return ctx.get(commandsCtx).call(insertTableCommand.key, { row: rows, col: columns })
}
