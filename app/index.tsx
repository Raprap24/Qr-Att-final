import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

// Fresh open always lands here first.
// No session -> /login diretso, dili mo-agi sa main screen.
// Naa session -> /(tabs).
export default function Index() {
  const { session, loading } = useAuth();

  if (loading) return null;
  if (session) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
