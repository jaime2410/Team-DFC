/**
 * Configuración oficial de Capacitor para empaquetar AlmeríaCerca (Reto 02)
 * como aplicación móvil híbrida (Android / iOS) conectada al despliegue serverless.
 */
const config = {
  appId: 'es.almeriacerca.app',
  appName: 'AlmeríaCerca',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  plugins: {
    Geolocation: {
      enableHighAccuracy: true,
    },
    Camera: {
      saveToGallery: false,
    },
  },
};

export default config;
