/**
 * Configuración oficial de Capacitor para empaquetar AlmeríaCerca (Reto 02)
 * como aplicación móvil nativa (Android / iOS) conectada al backend Next.js/Vercel
 * sin romper las rutas SSR ni los endpoints /api/*.
 */
const config = {
  appId: 'es.dipalme.almeriacerca',
  appName: 'AlmeríaCerca',
  webDir: 'public',
  server: {
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      backgroundColor: '#F7F1E5',
      launchShowDuration: 1500,
    },
    StatusBar: {
      backgroundColor: '#E45735',
      style: 'LIGHT',
    },
    Geolocation: {
      enableHighAccuracy: true,
    },
    Camera: {
      saveToGallery: false,
    },
  },
};

export default config;
