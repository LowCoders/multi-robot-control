import { useTranslation } from 'react-i18next'
import { LOCALE_STORAGE_KEY, type AppLocale } from '../../i18n/constants'

const FLAGS: Record<AppLocale, string> = {
  en: '🇬🇧',
  hu: '🇭🇺',
}

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation('common')
  const raw = i18n.resolvedLanguage ?? i18n.language
  const current = (raw.split('-')[0] === 'hu' ? 'hu' : 'en') as AppLocale

  const setLang = (next: AppLocale) => {
    if (next === current) return
    void i18n.changeLanguage(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const alternatives = (['en', 'hu'] as const).filter((lng) => lng !== current)

  return (
    <div
      className="inline-flex items-center gap-1.5"
      role="group"
      aria-label={t('languageSwitcher.ariaLabel')}
    >
      {alternatives.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLang(lng)}
          className={`
            flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-steel-700
            bg-steel-900/90 text-lg leading-none transition-colors
            hover:bg-steel-800 hover:border-steel-600
          `}
          title={t(`languageSwitcher.title.${lng}`)}
          aria-label={t(`languageSwitcher.title.${lng}`)}
        >
          <span aria-hidden>{FLAGS[lng]}</span>
        </button>
      ))}
    </div>
  )
}
