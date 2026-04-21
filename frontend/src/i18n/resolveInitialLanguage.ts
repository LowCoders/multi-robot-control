import type { AppLocale } from './constants'
import { isSupportedLocale, LOCALE_STORAGE_KEY } from './constants'

function normalizeLocaleTag(raw: string): AppLocale {
  const tag = raw.split('-')[0]?.toLowerCase() ?? 'en'
  return tag === 'hu' ? 'hu' : 'en'
}

/**
 * Priority: localStorage (user choice) → VITE_DEFAULT_LOCALE → browser → en.
 */
export function resolveInitialLanguage(): AppLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && isSupportedLocale(saved)) return saved
  } catch {
    /* ignore */
  }

  const env = import.meta.env.VITE_DEFAULT_LOCALE as string | undefined
  if (env && isSupportedLocale(env.trim())) return env.trim() as AppLocale

  try {
    return normalizeLocaleTag(navigator.language)
  } catch {
    return 'en'
  }
}
