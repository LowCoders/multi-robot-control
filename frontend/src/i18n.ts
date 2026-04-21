import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './locales/en/common.json'
import commonHu from './locales/hu/common.json'
import visualizationEn from './locales/en/visualization.json'
import visualizationHu from './locales/hu/visualization.json'
import pagesEn from './locales/en/pages.json'
import pagesHu from './locales/hu/pages.json'
import devicesEn from './locales/en/devices.json'
import devicesHu from './locales/hu/devices.json'
import { resolveInitialLanguage } from './i18n/resolveInitialLanguage'

export const defaultNS = 'common'
export const namespaces = ['common', 'visualization', 'pages', 'devices'] as const

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      visualization: visualizationEn,
      pages: pagesEn,
      devices: devicesEn,
    },
    hu: {
      common: commonHu,
      visualization: visualizationHu,
      pages: pagesHu,
      devices: devicesHu,
    },
  },
  lng: resolveInitialLanguage(),
  fallbackLng: 'en',
  defaultNS,
  ns: [...namespaces],
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
  debug: import.meta.env.DEV,
})

try {
  document.documentElement.lang = i18n.language
} catch {
  /* ignore */
}

i18n.on('languageChanged', (lng) => {
  try {
    document.documentElement.lang = lng
  } catch {
    /* ignore */
  }
})

export default i18n
