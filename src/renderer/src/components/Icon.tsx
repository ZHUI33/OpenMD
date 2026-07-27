import type { JSX } from 'react'

export type IconName =
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'close'
  | 'copy'
  | 'document'
  | 'edit'
  | 'export'
  | 'external'
  | 'file-plus'
  | 'files'
  | 'folder'
  | 'folder-open'
  | 'folder-plus'
  | 'image'
  | 'menu'
  | 'outline'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'sidebar'
  | 'trash'

interface IconProps {
  name: IconName
  size?: number
}

const paths: Record<IconName, JSX.Element> = {
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  close: (
    <>
      <path d="m7 7 10 10" />
      <path d="M17 7 7 17" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 14v6h14v-6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="m20 4-9 9" />
      <path d="M18 13v7H4V6h7" />
    </>
  ),
  'file-plus': (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 14h6M12 11v6" />
    </>
  ),
  files: (
    <>
      <path d="M7 3h7l4 4v12H7z" />
      <path d="M14 3v5h5" />
      <path d="M4 7v14h10" />
    </>
  ),
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  'folder-open': (
    <>
      <path d="M3 7h7l2 2h9" />
      <path d="m4 19 3-8h15l-3 8z" />
    </>
  ),
  'folder-plus': (
    <>
      <path d="M3 6h7l2 2h9v11H3z" />
      <path d="M9 14h6M12 11v6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m4 18 5-5 4 4 2-2 5 4" />
    </>
  ),
  menu: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  outline: (
    <>
      <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h8M10 18h6" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.4 17a8 8 0 1 1 1.4-7" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7L0 10.5v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7z"
        transform="translate(2.5 0) scale(.8)"
      />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </>
  ),
}

export function Icon({ name, size = 18 }: IconProps): JSX.Element {
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
