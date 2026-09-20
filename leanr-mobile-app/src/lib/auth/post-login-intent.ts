import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Carries "the visitor was trying to book a free demo" across the login/
 * signup screens, which have no other way to know why someone landed there —
 * every "Book a Free Demo" entry point (marketing home, marketing more,
 * a direct deep link to the old anonymous /book-free-demo screen) sets this
 * right before sending an unauthenticated visitor to /login, and
 * (auth)/_layout.tsx consumes it once a session exists to route into
 * (client)/demo-booking.tsx instead of the visitor's normal role home.
 */
const PENDING_BOOK_DEMO_KEY = 'leanr.pendingBookDemoIntent';

export async function setPendingBookDemoIntent() {
  await AsyncStorage.setItem(PENDING_BOOK_DEMO_KEY, 'true');
}

/** Reads and clears the flag in one step so a stale flag can never fire twice. */
export async function consumePendingBookDemoIntent(): Promise<boolean> {
  const value = await AsyncStorage.getItem(PENDING_BOOK_DEMO_KEY);
  if (value) await AsyncStorage.removeItem(PENDING_BOOK_DEMO_KEY);
  return value === 'true';
}
