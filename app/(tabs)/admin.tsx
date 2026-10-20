import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import {
  getAllProfiles,
  getProfile,
  setUserActive,
  setUserRole,
  type Profile,
  type Role,
} from '@/lib/profiles';
import {
  closeExpiredEvents,
  getAllEvents,
  setEventStatus,
  type CloudEvent,
} from '@/lib/events';
import {
  deleteAttendance,
  getAllAttendance,
  updateAttendance,
  type AdminAttendanceRecord,
  type AttendanceStatus,
} from '@/lib/attendance';

type Section = 'users' | 'events' | 'attendance';

const ROLE_LABELS: Record<Role, string> = {
  student: 'Student',
  teacher: 'Teacher',
  admin: 'Admin',
};

const STATUS_COLORS: Record<string, string> = {
  present: COLORS.success,
  late: COLORS.warning,
  absent: COLORS.danger,
  excused: COLORS.accent,
};

const STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'absent',
  'excused',
];

export default function AdminScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>('users');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [attendance, setAttendance] = useState<AdminAttendanceRecord[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const profile = await getProfile(user.id);
    const currentRole = profile?.role ?? 'student';
    setRole(currentRole);

    if (currentRole === 'admin') {
      await closeExpiredEvents();
      const [users, allEvents, records] = await Promise.all([
        getAllProfiles(),
        getAllEvents(),
        getAllAttendance(),
      ]);
      setProfiles(users);
      setEvents(allEvents);
      setAttendance(records);
    }
    setLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const changeRole = async (profile: Profile, nextRole: Role) => {
    if (profile.id === user?.id) {
      Alert.alert('Not allowed', 'You cannot change your own role.');
      return;
    }
    const { error } = await setUserRole(profile.id, nextRole);
    if (error) {
      Alert.alert('Error', error);
    } else {
      await load();
    }
  };

  const toggleActive = (profile: Profile) => {
    if (profile.id === user?.id) {
      Alert.alert('Not allowed', 'You cannot deactivate your own account.');
      return;
    }
    if (profile.is_active) {
      Alert.alert(
        'Deactivate account?',
        `${profile.full_name ?? profile.email} will no longer be able to sign in.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Deactivate',
            style: 'destructive',
            onPress: async () => {
              const { error } = await setUserActive(profile.id, false);
              if (error) Alert.alert('Error', error);
              else await load();
            },
          },
        ]
      );
      return;
    }
    setUserActive(profile.id, true).then(async ({ error }) => {
      if (error) Alert.alert('Error', error);
      else await load();
    });
  };

  const toggleEventStatus = (event: CloudEvent) => {
    const nextStatus = event.status === 'open' ? 'closed' : 'open';
    Alert.alert(
      nextStatus === 'closed' ? 'Close event?' : 'Reopen event?',
      nextStatus === 'closed'
        ? 'Students will no longer be able to record attendance.'
        : 'Students will be able to scan this event again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'closed' ? 'Close' : 'Reopen',
          style: nextStatus === 'closed' ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await setEventStatus(event.id, nextStatus);
            if (error) Alert.alert('Error', error);
            else await load();
          },
        },
      ]
    );
  };

  const correctStatus = async (
    record: AdminAttendanceRecord,
    status: AttendanceStatus
  ) => {
    if (record.status === status) return;
    const { error } = await updateAttendance(record.id, { status });
    if (error) Alert.alert('Error', error);
    else await load();
  };

  const removeRecord = (record: AdminAttendanceRecord) => {
    Alert.alert(
      'Delete attendance?',
      `Remove ${record.studentName ?? 'this student'}'s record for ${record.eventTitle}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteAttendance(record.id);
            if (error) Alert.alert('Error', error);
            else await load();
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.muted}>Loading dashboard...</Text>
      </View>
    );
  }

  if (role !== 'admin') {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="shield-outline"
          size={48}
          color={COLORS.textSecondary}
        />
        <Text style={styles.title}>Administrators Only</Text>
        <Text style={styles.muted}>
          This dashboard is only available to administrator accounts.
        </Text>
      </View>
    );
  }

  const attendanceCounts = attendance.reduce(
    (acc, record) => {
      acc[record.status] = (acc[record.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const openEvents = events.filter((event) => event.status === 'open').length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Admin Dashboard</Text>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{profiles.length}</Text>
          <Text style={styles.statLabel}>Users</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{events.length}</Text>
          <Text style={styles.statLabel}>Events</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{openEvents}</Text>
          <Text style={styles.statLabel}>Open</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{attendance.length}</Text>
          <Text style={styles.statLabel}>Records</Text>
        </View>
      </View>

      <View style={styles.statusSummary}>
        {STATUSES.map((status) => (
          <View
            key={status}
            style={[
              styles.statusSummaryItem,
              { borderColor: STATUS_COLORS[status] },
            ]}
          >
            <Text
              style={[
                styles.statusSummaryValue,
                { color: STATUS_COLORS[status] },
              ]}
            >
              {attendanceCounts[status] ?? 0}
            </Text>
            <Text style={styles.statusSummaryLabel}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.segmentRow}>
        {(['users', 'events', 'attendance'] as Section[]).map((item) => (
          <Pressable
            key={item}
            style={[
              styles.segment,
              section === item && styles.segmentActive,
            ]}
            onPress={() => setSection(item)}
          >
            <Text
              style={[
                styles.segmentText,
                section === item && styles.segmentTextActive,
              ]}
            >
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {section === 'users' ? (
        <View style={styles.section}>
          {profiles.length === 0 ? (
            <Text style={styles.muted}>No users found.</Text>
          ) : (
            profiles.map((profile) => (
              <View key={profile.id} style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>
                    {profile.full_name || 'Unnamed user'}
                  </Text>
                  <View
                    style={[
                      styles.roleBadge,
                      profile.role === 'admin'
                        ? styles.roleAdmin
                        : profile.role === 'teacher'
                          ? styles.roleTeacher
                          : styles.roleStudent,
                    ]}
                  >
                    <Text style={styles.roleBadgeText}>
                      {ROLE_LABELS[profile.role]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>{profile.email}</Text>
                <Text style={styles.meta}>
                  {profile.is_active ? 'Active' : 'Deactivated'}
                </Text>

                <View style={styles.chipRow}>
                  {(['student', 'teacher', 'admin'] as Role[]).map(
                    (nextRole) => (
                      <Pressable
                        key={nextRole}
                        style={[
                          styles.chip,
                          profile.role === nextRole && styles.chipActive,
                        ]}
                        onPress={() => changeRole(profile, nextRole)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            profile.role === nextRole &&
                              styles.chipTextActive,
                          ]}
                        >
                          {ROLE_LABELS[nextRole]}
                        </Text>
                      </Pressable>
                    )
                  )}
                </View>

                <Pressable
                  style={[
                    styles.smallButton,
                    profile.is_active
                      ? styles.deactivateButton
                      : styles.activateButton,
                  ]}
                  onPress={() => toggleActive(profile)}
                >
                  <Ionicons
                    name={
                      profile.is_active
                        ? 'person-remove-outline'
                        : 'person-add-outline'
                    }
                    size={16}
                    color={COLORS.textPrimary}
                  />
                  <Text style={styles.smallButtonText}>
                    {profile.is_active ? 'Deactivate' : 'Activate'}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}

      {section === 'events' ? (
        <View style={styles.section}>
          {events.length === 0 ? (
            <Text style={styles.muted}>No events created yet.</Text>
          ) : (
            events.map((event) => {
              const count = attendance.filter(
                (record) => record.eventId === event.id
              ).length;
              return (
                <View key={event.id} style={styles.card}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>{event.title}</Text>
                    <View
                      style={[
                        styles.roleBadge,
                        event.status === 'open'
                          ? styles.roleStudent
                          : styles.roleClosed,
                      ]}
                    >
                      <Text style={styles.roleBadgeText}>
                        {event.status.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.meta}>{event.event_code}</Text>
                  {event.start_time ? (
                    <Text style={styles.meta}>
                      {new Date(event.start_time).toLocaleString()}
                    </Text>
                  ) : null}
                  {event.venue ? (
                    <Text style={styles.meta}>{event.venue}</Text>
                  ) : null}
                  <Text style={styles.meta}>{count} attendance records</Text>

                  <View style={styles.actionRow}>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() =>
                        router.push(`/event/${event.id}` as any)
                      }
                    >
                      <Ionicons
                        name="create-outline"
                        size={16}
                        color={COLORS.textPrimary}
                      />
                      <Text style={styles.smallButtonText}>Manage</Text>
                    </Pressable>
                    <Pressable
                      style={styles.smallButton}
                      onPress={() => toggleEventStatus(event)}
                    >
                      <Ionicons
                        name={
                          event.status === 'open'
                            ? 'lock-closed-outline'
                            : 'lock-open-outline'
                        }
                        size={16}
                        color={COLORS.textPrimary}
                      />
                      <Text style={styles.smallButtonText}>
                        {event.status === 'open' ? 'Close' : 'Reopen'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {section === 'attendance' ? (
        <View style={styles.section}>
          {attendance.length === 0 ? (
            <Text style={styles.muted}>No attendance records yet.</Text>
          ) : (
            attendance.map((record) => (
              <View key={record.id} style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>
                    {record.studentName ||
                      record.studentEmail ||
                      `Student ${record.studentId.slice(0, 8)}`}
                  </Text>
                  <View
                    style={[
                      styles.roleBadge,
                      { borderColor: STATUS_COLORS[record.status] },
                    ]}
                  >
                    <Text
                      style={[
                        styles.roleBadgeText,
                        { color: STATUS_COLORS[record.status] },
                      ]}
                    >
                      {record.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {record.studentEmail ?? 'No email on file'}
                </Text>
                <Text style={styles.meta}>
                  {record.eventTitle} ({record.eventCode})
                </Text>
                <Text style={styles.meta}>
                  {new Date(record.scannedAt).toLocaleString()}
                </Text>

                <Text style={styles.correctionLabel}>Correct status</Text>
                <View style={styles.chipRow}>
                  {STATUSES.map((status) => (
                    <Pressable
                      key={status}
                      style={[
                        styles.chip,
                        record.status === status && styles.chipActive,
                      ]}
                      onPress={() => correctStatus(record, status)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          record.status === status && styles.chipTextActive,
                        ]}
                      >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  style={[styles.smallButton, styles.deactivateButton]}
                  onPress={() => removeRecord(record)}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={COLORS.textPrimary}
                  />
                  <Text style={styles.smallButtonText}>Delete record</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 14,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  muted: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 14,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  statusSummary: {
    flexDirection: 'row',
    gap: 8,
  },
  statusSummaryItem: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  statusSummaryValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statusSummaryLabel: {
    fontSize: 10,
    color: COLORS.textSecondary,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#E6000022',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  section: {
    gap: 12,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 14,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  meta: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  roleBadge: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleAdmin: {
    borderColor: COLORS.warning,
    backgroundColor: '#FBBF2422',
  },
  roleTeacher: {
    borderColor: COLORS.primary,
    backgroundColor: '#E6000022',
  },
  roleStudent: {
    borderColor: COLORS.accent,
    backgroundColor: '#FF3B3022',
  },
  roleClosed: {
    borderColor: COLORS.muted,
    backgroundColor: '#8A8A8A22',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 6,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: COLORS.primary,
    backgroundColor: '#E6000022',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  chipTextActive: {
    color: COLORS.textPrimary,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  smallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  deactivateButton: {
    borderColor: COLORS.danger,
  },
  activateButton: {
    borderColor: COLORS.success,
  },
  correctionLabel: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
  },
});
