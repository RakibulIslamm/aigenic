import type { Metadata } from 'next';
import { Geist_Mono, Inter, Space_Grotesk } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import { Toaster } from 'sonner';
import './globals.css';
import { cn } from '@/lib/utils';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const spaceGrotesk = Space_Grotesk({
  variable: '--font-heading',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Aigenic — AI customer support for any site',
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
          inter.variable,
          geistMono.variable,
          spaceGrotesk.variable
        )}
        suppressHydrationWarning
      >
        <body suppressHydrationWarning className="min-h-full bg-background font-sans text-foreground antialiased">
          {children}
          <Toaster richColors position="top-right" theme="dark" />
        </body>
        <script
          src="https://aigenicapp.vercel.app/widget.js"
          data-site="05880e43-fd91-4cb3-8ad0-1667073f5980"
          async
        ></script>
      </html>
    </ClerkProvider>
  );
}
