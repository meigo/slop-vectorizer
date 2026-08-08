/** Light/dark theme: initialized from localStorage, else the OS preference;
 * toggling flips `.dark` on <html> and persists. */
function initial(): 'light' | 'dark' {
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(t: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

class Theme {
  current = $state<'light' | 'dark'>(initial())
  constructor() {
    apply(this.current)
  }
  toggle() {
    this.current = this.current === 'dark' ? 'light' : 'dark'
    apply(this.current)
    localStorage.setItem('theme', this.current)
  }
}

export const theme = new Theme()
