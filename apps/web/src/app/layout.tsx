import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, Roboto_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { Providers } from './providers';
import './globals.css';

// Auction is the default Twilight theme; legacy is opt-in via env.
const UI_THEME = (process.env.NEXT_PUBLIC_UI_THEME ?? 'auction').toLowerCase();
const theme: 'auction' | 'legacy' = UI_THEME === 'legacy' ? 'legacy' : 'auction';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-serif',
  adjustFontFallback: false,
});
const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Twilight Core Explorer',
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
      className={`${inter.variable} ${instrumentSerif.variable} ${robotoMono.variable}`}
    >
      <body className="bg-background text-text">
        <div className="min-h-screen bg-[#050505] flex flex-col">
          <Providers>
            <Header />
            <main className="flex-1 w-full lg:w-[1432px] lg:mx-auto px-4 sm:px-6 lg:px-[156px] pt-20 lg:pt-[57px] pb-6 lg:pb-12">
              {children}
            </main>
            <Footer />
          </Providers>
        </div>
      </body>
    </html>
  );
}
