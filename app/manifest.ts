import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AlmeríaCerca — Tu Ayuntamiento a un mensaje',
    short_name: 'AlmeríaCerca',
    description:
      'Plataforma ciudadana multi-municipio, accesible y multi-idioma para la provincia de Almería.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F7F1E5',
    theme_color: '#E45735',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
      {
        src: '/icon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
