import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Jeffy app config.
 *
 * Everything the app needs at runtime arrives through EXPO_PUBLIC_* env vars.
 * Only the Supabase URL and anon key ship in the bundle — both are safe to
 * expose, because every table is behind RLS and every secret (Anthropic,
 * product lookup) lives in an Edge Function.
 */

const BUNDLE_ID = process.env.EXPO_PUBLIC_BUNDLE_ID ?? 'com.jeffy.app';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Jeffy',
  slug: 'jeffy',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'jeffy',
  userInterfaceStyle: 'automatic',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: false,
    // Sign in with Apple. Requires the capability on the App ID, which EAS
    // provisions automatically once a paid Apple Developer account is linked.
    usesAppleSignIn: true,
    infoPlist: {
      // Jeffy has no reason to reach a plaintext host.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#0E0E10',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-apple-authentication',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        dark: { backgroundColor: '#0E0E10' },
        image: './assets/images/splash-icon.png',
        imageWidth: 92,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'Jeffy uses the camera to photograph your clothes and scan price tags.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Jeffy needs your photo library to add existing photos of clothes and inspiration looks.',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Jeffy uses your approximate location only to check today’s weather when suggesting an outfit.',
        isIosBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission:
          'Jeffy reads your calendar to see what today looks like before suggesting an outfit. It never writes to it.',
      },
    ],
    [
      'expo-local-authentication',
      { faceIDPermission: 'Jeffy uses Face ID to unlock your closet.' },
    ],
    [
      'expo-notifications',
      { color: '#0E0E10', defaultChannel: 'default' },
    ],
    [
      'expo-build-properties',
      { ios: { deploymentTarget: '16.0' } },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
});
