import type { Metadata } from 'next';
import { Geist, Geist_Mono, Inter, Instrument_Serif } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import './globals.css';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const instrumentSerif = Instrument_Serif({
  variable: '--font-serif',
  weight: '400',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'AgentDesk — AI customer support for any site',
  description:
    'Add a trained AI support agent to your site in 60 seconds. Knowledge-base aware, multi-tenant, embeddable.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: '#7c5cff',
        },
      }}
    >
      <html
        lang="en"
        className={cn(
          'h-full dark',
          geistSans.variable,
          geistMono.variable,
          inter.variable,
          instrumentSerif.variable
        )}
        suppressHydrationWarning
      >
        <body className="min-h-full bg-background font-sans text-foreground antialiased">
          {children}
          <Toaster richColors position="top-right" theme="dark" />
        </body>
      </html>
    </ClerkProvider>
  );
}
