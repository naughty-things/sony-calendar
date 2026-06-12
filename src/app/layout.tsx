import './globals.css';
import type { Metadata } from 'next';
import { startSelfPing } from '@/lib/inbound/selfPing';

// Start the Gmail poller on the server. Only runs in Node (Railway/self-hosted).
// On Vercel, the /api/cron/poll endpoint is used instead.
if (typeof window === 'undefined') {
  startSelfPing();
}

export const metadata: Metadata = {
  title: 'SONY Content Calendar',
  description: 'SONY social content calendar with AI email agent'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
