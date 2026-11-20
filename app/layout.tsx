import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/I18nProvider';
import { MunicipalityProvider } from '@/lib/municipality/MunicipalityProvider';
import { AppShell } from '@/components/AppShell';

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AlmeríaCerca — Tu Ayuntamiento, a un mensaje',
  description:
    'Plataforma ciudadana multi-municipio, accesible y multi-idioma para la provincia de Almería.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" dir="ltr" className={`${outfit.variable} ${plusJakarta.variable}`}>
      <body className="font-sans bg-arena text-tinta antialiased">
        <I18nProvider>
          <MunicipalityProvider>
            <AppShell>{children}</AppShell>
          </MunicipalityProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
