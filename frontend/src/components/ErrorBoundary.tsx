import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createLogger } from '../utils/logger'
import i18n from '../i18n'

const log = createLogger('ui:error-boundary')

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  message?: string
}

/**
 * Route / oldal szintű hibaelkapás — megakadályozza, hogy egy renderhiba
 * az egész alkalmazást fehér képernyőre vigye.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('React tree error:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-6 text-red-300 bg-steel-900 min-h-[40vh]">
            <h1 className="text-lg font-semibold mb-2">{i18n.t('common:errorBoundary.title')}</h1>
            <p className="text-sm opacity-90">{this.state.message}</p>
          </div>
        )
      )
    }
    return this.props.children
  }
}
