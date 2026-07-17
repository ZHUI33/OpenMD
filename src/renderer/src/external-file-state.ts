import type { WorkspaceFileChange } from '../../shared/desktop-api.types'

export type ExternalFileAction = 'reload' | 'show-conflict' | 'show-deleted'
export type ExternalFileStatus = 'clean' | 'conflict' | 'deleted'

export interface ExternalFileResolution {
  action: ExternalFileAction
  status: ExternalFileStatus
}

/**
 * Pure state transition used by the renderer when the trusted main-process
 * watcher reports a change. OpenMD save echoes are removed before this point.
 */
export function resolveExternalFileChange(
  event: Pick<WorkspaceFileChange, 'type'>,
  tabDirty: boolean,
): ExternalFileResolution {
  if (event.type === 'deleted') return { action: 'show-deleted', status: 'deleted' }
  if (tabDirty) return { action: 'show-conflict', status: 'conflict' }
  return { action: 'reload', status: 'clean' }
}
