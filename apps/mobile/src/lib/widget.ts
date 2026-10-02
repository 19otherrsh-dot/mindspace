import { Platform } from 'react-native';

/** Must match the App Group configured for the widget extension. */
const APP_GROUP = 'group.app.mindspace.client.expowidgets';

/**
 * Publishes the home-screen widget's data.
 *
 * The streak is not part of `User` — it comes from the home feed, which is
 * what the widget shows — so this is called from the screen that loads that
 * feed rather than from the auth store. Passing `null` clears the widget,
 * which is what sign-out should do.
 */
export function syncWidget(streak: number | null): void {
  // No widget host on web, and the native module is not linked there.
  if (Platform.OS === 'web') return;

  try {
    /*
     * Required lazily rather than imported: `@bittingz/expo-widgets` resolves
     * its native module at import time and throws when there is none — in
     * Expo Go, and under Jest. A decorative widget must not take down the
     * module that imports it, and the auth store is on that path.
     */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const widgets = require('@bittingz/expo-widgets') as {
      setWidgetData: (data: string, appGroup: string) => void;
    };
    widgets.setWidgetData(JSON.stringify({ streak: streak ?? 0 }), APP_GROUP);
  } catch {
    // No development build, or the extension is not installed on this device.
  }
}
