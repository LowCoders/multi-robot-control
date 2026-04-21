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

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-lg border border-steel-700 bg-steel-900/90 p-0.5"
      role="group"
      aria-label={t('languageSwitcher.ariaLabel')}
    >
      {(['en', 'hu'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLang(lng)}
          className={`
            rounded px-2 py-1 text-lg leading-none transition-colors
            ${current === lng ? 'bg-machine-600/30 ring-1 ring-machine-500/50' : 'opacity-70 hover:opacity-100 hover:bg-steel-800'}
          `}
          title={t(`languageSwitcher.title.${lng}`)}
          aria-pressed={current === lng}
          aria-label={t(`languageSwitcher.title.${lng}`)}
        >
          <span aria-hidden>{FLAGS[lng]}</span>
        </button>
      ))}
    </div>
  )
}
