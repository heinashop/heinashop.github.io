import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useApi } from '../context/useApi'
import './customer-lookup.css'
import { CustomerLookupExperience } from './customer-portal/CustomerLookupExperience'
import { CustomerLookupSiteSections } from './customer-portal/CustomerLookupSiteSections'
import { useCustomerPortalSearch } from './customer-portal/useCustomerPortalSearch'

const PAGE_TITLE = 'Heina訂單自助查詢'
const BRAND_HEINA = 'Heina'
const BRAND_SYSTEM = '訂單自助查詢'

const NAV = [
  { href: '#order-search', label: '訂單查詢' },
  { href: '#closing-soon', label: '即將結單' },
  { href: '#open-groups', label: '開團專區' },
  { href: '#news', label: '最新公告' },
  { href: '#guide', label: '代購流程' },
  { href: '#faq', label: '常見問題' },
  { href: '#contact', label: '聯絡客服' },
] as const

export function CustomerLookupPage() {
  const api = useApi()
  const [searchParams] = useSearchParams()
  const searchState = useCustomerPortalSearch(api)
  const { portal } = searchState
  const [menuOpen, setMenuOpen] = useState(false)

  const hasResults =
    searchState.searched && !searchState.loading && searchState.totalMatches > 0
  const showingResultsPane = searchState.searched && !searchState.loading

  useEffect(() => {
    if (!searchParams.get('q')?.trim() || !hasResults) return
    requestAnimationFrame(() => {
      document.getElementById('order-search')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [hasResults, searchParams])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const resetToHome = searchState.resetToHome
  const goHome = useCallback(() => {
    resetToHome()
  }, [resetToHome])

  const onNavClick = useCallback(
    (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
      setMenuOpen(false)
      if (!showingResultsPane) return
      e.preventDefault()
      goHome()
      requestAnimationFrame(() => {
        document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [goHome, showingResultsPane],
  )

  return (
    <div className="lk">
      <header className="lk-site-header">
        <div className="lk-site-header-inner">
          <a
            className="lk-site-brand"
            href="#top"
            onClick={(e) => {
              e.preventDefault()
              setMenuOpen(false)
              if (showingResultsPane) goHome()
              else window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            <span className="lk-brand-mark" aria-hidden>
              {portal.avatarUrl?.trim() ? <img src={portal.avatarUrl.trim()} alt="" /> : 'H'}
            </span>
            <span className="lk-site-brand-text">
              <span className="lk-brand-name">
                <span className="lk-brand-heina">{BRAND_HEINA}</span>
                <span className="lk-brand-system">{BRAND_SYSTEM}</span>
              </span>
              <span className="lk-brand-sub">顧客專區</span>
            </span>
          </a>

          <nav className="lk-site-nav lk-site-nav--desktop" aria-label="頁面導覽">
            {NAV.map((item) => (
              <a
                key={item.href}
                className="lk-site-nav-link"
                href={item.href}
                onClick={onNavClick(item.href)}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <button
            type="button"
            className="lk-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="lk-site-menu"
            aria-label={menuOpen ? '關閉選單' : '開啟選單'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>

        {menuOpen ? (
          <div className="lk-site-menu" id="lk-site-menu">
            <nav className="lk-site-menu-nav" aria-label="手機導覽">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  className="lk-site-menu-link"
                  href={item.href}
                  onClick={onNavClick(item.href)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        ) : null}
      </header>

      {menuOpen ? (
        <button
          type="button"
          className="lk-menu-backdrop"
          aria-label="關閉選單"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <section className="lk-hero lk-hero--journal" id="top">
        <div className="lk-hero-inner">
          <h1 className="lk-hero-title">
            <span className="lk-spark" aria-hidden />
            {PAGE_TITLE}
            <span className="lk-spark" aria-hidden />
          </h1>
        </div>
      </section>

      <main className="lk-main">
        <div className="lk-main-inner" id="order-search">
          <CustomerLookupExperience
            query={searchState.query}
            setQuery={searchState.setQuery}
            lookupPin={searchState.lookupPin}
            setLookupPin={searchState.setLookupPin}
            loading={searchState.loading}
            error={searchState.error}
            searched={searchState.searched}
            matchesGroupbuy={searchState.matchesGroupbuy}
            matchesPreorder={searchState.matchesPreorder}
            totalMatches={searchState.totalMatches}
            expandedId={searchState.expandedId}
            setExpandedId={searchState.setExpandedId}
            onSearch={() => void searchState.search()}
            onBackHome={goHome}
            membership={searchState.membership}
            extraNote={portal.extraNote}
            lookupDesc={portal.lookupDesc}
            autoSync={searchState.autoSync}
          />
        </div>

        <CustomerLookupSiteSections portal={portal} showInfo={!hasResults} />
      </main>

      <footer className="lk-site-footer">
        <div className="lk-site-footer-inner">
          <div className="lk-site-footer-brand">
            <p className="lk-footer-brand-name">{PAGE_TITLE}</p>
          </div>
          <div className="lk-site-footer-meta">
            {portal.footer?.trim() ? <p className="lk-footer-text">{portal.footer.trim()}</p> : null}
            <Link to="/login" className="lk-footer-admin">
              團主後台
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
