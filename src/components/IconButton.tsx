import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function IconButton({ label, active, danger, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean; children: ReactNode }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} className={`icon-button ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className}`} {...props}>{children}</button>
}
