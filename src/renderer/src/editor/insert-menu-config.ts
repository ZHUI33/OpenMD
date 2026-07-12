import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit'

export const OPEN_MD_INSERT_COMMANDS = [
  'heading',
  'quote',
  'bullet-list',
  'ordered-list',
  'task-list',
  'table',
  'code-block',
  'divider',
] as const

export type OpenMdInsertCommand = (typeof OPEN_MD_INSERT_COMMANDS)[number]

/**
 * Localizes and limits Crepe's lightweight floating block menu to the block
 * types OpenMD supports in phase 4. Crepe supplies the compact add button,
 * filtering, keyboard navigation, and the actual Milkdown commands.
 */
export const openMdInsertMenuConfig: BlockEditFeatureConfig = {
  textGroup: {
    label: '文本',
    text: { label: '正文' },
    h1: { label: '一级标题' },
    h2: { label: '二级标题' },
    h3: { label: '三级标题' },
    h4: { label: '四级标题' },
    h5: { label: '五级标题' },
    h6: { label: '六级标题' },
    quote: { label: '引用' },
    divider: { label: '分割线' },
  },
  listGroup: {
    label: '列表',
    bulletList: { label: '无序列表' },
    orderedList: { label: '有序列表' },
    taskList: { label: '任务列表' },
  },
  advancedGroup: {
    label: '插入',
    image: null,
    codeBlock: { label: '代码块' },
    table: { label: '表格' },
    math: null,
  },
}
