import { Button } from './button'

export function SectionMenu({ label, items, value, onChange }: {
  label: string
  items: readonly { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return <nav aria-label={label} className="flex flex-wrap gap-1 border-b border-grey-200 pb-3">
    {items.map(item => <Button key={item.id} type="button" size="sm"
      variant={value === item.id ? 'secondary' : 'ghost'}
      aria-current={value === item.id ? 'page' : undefined}
      className={value === item.id ? 'font-semibold' : 'text-grey-600'}
      onClick={() => onChange(item.id)}>{item.label}</Button>)}
  </nav>
}
