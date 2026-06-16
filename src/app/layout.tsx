import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { startSelfPing } from '@/lib/inbound/selfPing';
import { AuthProvider } from '@/lib/auth/AuthProvider';

if (typeof window === 'undefined') {
  startSelfPing();
}

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap'
});

const sans = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap'
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'SONY — Content Calendar',
  description: 'Production calendar for SONY social. Email in, calendar out.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'SONY Calendar'
  },
  formatDetection: { telephone: false }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#F4F1EA'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="text-ink">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
