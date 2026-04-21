/** localStorage key for persisted UI language choice */
export const LOCALE_STORAGE_KEY = 'appLocale'

export const SUPPORTED_LOCALES = ['en', 'hu'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export function isSupportedLocale(value: string | undefined | null): value is AppLocale {
  return value === 'en' || value === 'hu'
}
