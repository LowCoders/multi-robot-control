import type { ComponentDef } from './types'

/** Resolved UI language segment from i18next (`en` | `hu`, default `en`). */
export function resolveUiLang(language: string | undefined): 'en' | 'hu' {
  const tag = language?.split('-')[0]?.toLowerCase()
  return tag === 'hu' ? 'hu' : 'en'
}

export function localizedPartName(component: ComponentDef, language: string | undefined): string {
  return resolveUiLang(language) === 'hu' ? component.nameHu : component.nameEn
}

export function localizedPartDescription(component: ComponentDef, language: string | undefined): string | undefined {
  const hu = component.descriptionHu
  const en = component.descriptionEn
  if (!hu && !en) return undefined
  return resolveUiLang(language) === 'hu' ? (hu ?? en) : (en ?? hu)
}
