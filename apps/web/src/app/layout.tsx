import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { StatusStrip } from '@/components/StatusStrip';
import { GlobalStatusBanner } from '@/components/freshness/GlobalStatusBanner';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Providers } from './providers';
import './globals.css';

// `dark` (gold on near-black, the twilight.org auction look) is the default theme; `light` is its
// paper counterpart.
const UI_THEME = (process.env.NEXT_PUBLIC_UI_THEME ?? 'dark').toLowerCase();
const theme: 'dark' | 'light' = UI_THEME === 'light' ? 'light' : 'dark';

// Faces are bound to UNIQUE css vars (not the role names). globals.css maps the semantic roles
// (--font-sans / --font-serif / --font-mono / --font-metric) onto these. Brand trio from the
// reference: Instrument Serif for display headings, Inter for UI copy, JetBrains Mono for every
// number, hash, address and caption.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-instrument-serif',
});
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  // `%s` is filled by each route's `metadata.title`; routes without one fall back to `default`.
  title: { default: 'Twilight Core Explorer', template: '%s · Twilight Core Explorer' },
  description:
    'Operator-grade explorer for Twilight Core — CoreSlot PoA, liveness, rewards, and network health.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="bg-background text-text">
        {/* Apply the persisted brand theme before paint (no FOUC); overrides SSR defaults.
            Also migrates any theme id stored before the set was reduced to dark/light, so a stale
            value cannot leave the page with no palette. With no persisted choice, an OS light-mode
            preference selects the light theme — an explicit toggle pick always wins thereafter. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var m={auction:'dark',daylight:'light','gold-orbit':'dark','minimal-operator':'dark',legacy:'dark'};var t=localStorage.getItem('tw-theme');if(t){t=m[t]||t;if(t!=='dark'&&t!=='light'){t='dark';}document.documentElement.dataset.theme=t;localStorage.setItem('tw-theme',t);localStorage.removeItem('tw-density');}else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches){document.documentElement.dataset.theme='light';}}catch(e){}})();",
          }}
        />
        {/* WCAG 2.4.1 — first focusable element: bypass the header/nav straight to content. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-primary"
        >
          Skip to main content
        </a>
        <div className="min-h-screen bg-background flex flex-col">
          <Providers>
            <StatusStrip />
            <Header />
            <GlobalStatusBanner />
            <main
              id="main"
              tabIndex={-1}
              // No focus:outline-none — the global :focus-visible ring shows where focus lands after
              // "Skip to main content" is activated, so keyboard users see the destination (PR #40).
              className="mx-auto w-full max-w-[1200px] flex-1 px-5 pb-20 pt-8"
            >
              {children}
            </main>
            <Footer />
          </Providers>
        </div>
        <ThemeToggle />
      </body>
    </html>
  );
}
