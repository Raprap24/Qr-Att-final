import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import Header from '@/components/Header';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import { getOpenEvents, type CloudEvent } from '@/lib/events';
import {
  getAttendanceHistory,
  type AttendanceRecord,
} from '@/lib/attendance';

function formatWhen(event: CloudEvent) {
  if (!event.start_time) return 'Schedule to be announced';
  return new Date(event.start_time).toLocaleString();
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={[styles.statCard, { borderColor: `${color}66` }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [profile, openEvents, records] = await Promise.all([
      getProfile(user.id),
      getOpenEvents(),
      getAttendanceHistory(user.id),
    ]);
    setRole(profile?.role ?? 'student');
    setName(profile?.full_name ?? null);
    setEvents(openEvents);
    setHistory(records);
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const presentCount = history.filter(
    (record) => record.status === 'present'
  ).length;
  const lateCount = history.filter(
    (record) => record.status === 'late'
  ).length;
  const totalCount = history.length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Header title="QR Attendance" />

        <Text style={styles.greeting}>
          {name ? `Hi, ${name}` : 'Welcome'}
        </Text>
        <Text style={styles.subtitle}>
          Scan event QR codes, manage events, and keep attendance records in
          one place.
        </Text>

        <View style={styles.actions}>
          {role === 'student' ? (
            <>
              <View style={styles.statsRow}>
                <StatCard
                  label="Present"
                  value={presentCount}
                  color={COLORS.success}
                />
                <StatCard
                  label="Late"
                  value={lateCount}
                  color={COLORS.warning}
                />
                <StatCard
                  label="Total"
                  value={totalCount}
                  color={COLORS.primary}
                />
              </View>
              <AppButton
                theme="primary"
                title="Scan QR Code"
                icon="qr-code-outline"
                onPress={() => router.push('/scan')}
              />
              <AppButton
                title="Attendance History"
                icon="time-outline"
                onPress={() => router.push('/history')}
              />
            </>
          ) : null}

          {role === 'teacher' || role === 'admin' ? (
            <AppButton
              theme="primary"
              title="Manage Events"
              icon="calendar-outline"
              onPress={() => router.push('/teacher')}
            />
          ) : null}

          {role === 'admin' ? (
            <AppButton
              title="Admin Dashboard"
              icon="shield-checkmark-outline"
              onPress={() => router.push('/admin')}
            />
          ) : null}

          <AppButton
            title="Profile"
            icon="person-outline"
            onPress={() => router.push('/profile')}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Available Events</Text>
          <Text style={styles.sectionCount}>{events.length}</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={styles.loader} />
        ) : events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No open events</Text>
            <Text style={styles.emptyText}>
              Teachers and administrators have not opened any events yet.
            </Text>
          </View>
        ) : (
          events.map((event) => (
            <View key={event.id} style={styles.eventCard}>
              <View style={styles.eventHeader}>
                <Text style={styles.eventTitle}>{event.title}</Text>
                <View style={styles.openBadge}>
                  <Text style={styles.openBadgeText}>Open</Text>
                </View>
              </View>
              <Text style={styles.eventMeta}>{event.event_code}</Text>
              <Text style={styles.eventMeta}>{formatWhen(event)}</Text>
              {event.venue ? (
                <Text style={styles.eventMeta}>{event.venue}</Text>
              ) : null}
              {event.description ? (
                <Text style={styles.eventDescription}>
                  {event.description}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: COLORS.textSecondary,
  },
  actions: {
    gap: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  sectionCount: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  loader: {
    marginVertical: 24,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  eventCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 4,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  openBadge: {
    backgroundColor: COLORS.success,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  openBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#06281E',
  },
  eventMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  eventDescription: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  },
});
