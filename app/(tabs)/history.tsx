import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import {
  EVENT_GRACE_MINUTES,
  isEventPastGrace,
  setEventStatus,
} from '@/lib/events';
import {
  getAttendanceHistory,
  getTeacherClasses,
  markAllPresent,
  markAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
  type RosterStudent,
  type TeacherClass,
} from '@/lib/attendance';

function shortId(id: string) {
  return id ? `…${id.slice(-8)}` : 'unknown';
}

function initials(student: RosterStudent) {
  const source = (student.studentName || student.studentEmail || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  const value = parts.map((part) => part[0]).join('').toUpperCase();
  return value || '?';
}

function studentMeta(student: RosterStudent) {
  if (!student.status) return 'No record yet';

  const time = student.scannedAt
    ? new Date(student.scannedAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  if (student.status === 'present' || student.status === 'late') {
    return time ? `${time} check-in` : 'Checked in';
  }

  return `Marked ${student.status}`;
}

function withCounts(event: TeacherClass): TeacherClass {
  const presentCount = event.students.filter(
    (student) => student.status === 'present'
  ).length;
  const lateCount = event.students.filter(
    (student) => student.status === 'late'
  ).length;
  const absentCount = event.students.filter(
    (student) => student.status === 'absent'
  ).length;
  const excusedCount = event.students.filter(
    (student) => student.status === 'excused'
  ).length;

  return {
    ...event,
    presentCount,
    lateCount,
    absentCount,
    excusedCount,
    markedCount: event.students.filter(
      (student) => student.status !== null
    ).length,
    totalCount: event.students.length,
  };
}

const STATUS_COLORS: Record<string, string> = {
  present: COLORS.success,
  late: COLORS.warning,
  absent: COLORS.danger,
  excused: COLORS.magenta,
};

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'absent',
  'excused',
];

function StatusPill({ status }: { status: string }) {
  return (
    <View
      style={[
        styles.statusPill,
        { borderColor: STATUS_COLORS[status] ?? COLORS.border },
      ]}
    >
      <Text
        style={[
          styles.statusPillText,
          { color: STATUS_COLORS[status] ?? COLORS.textSecondary },
        ]}
      >
        {status.toUpperCase()}
      </Text>
    </View>
  );
}

function BreakdownItem({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <View style={styles.breakdownItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.breakdownValue}>{value}</Text>
      <Text style={styles.breakdownLabel}>{label}</Text>
    </View>
  );
}

export default function HistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [studentRecords, setStudentRecords] = useState<AttendanceRecord[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [markingKey, setMarkingKey] = useState<string | null>(null);

  const load = useCallback(
    async (showLoader = true) => {
      if (!user) {
        setLoading(false);
        return;
      }

      if (showLoader) setLoading(true);

      const profile = await getProfile(user.id);
      const currentRole = profile?.role ?? 'student';
      setRole(currentRole);

      if (currentRole === 'teacher') {
        const list = await getTeacherClasses(user.id);
        setClasses(list);
        setStudentRecords([]);
      } else {
        const records = await getAttendanceHistory(user.id);
        setStudentRecords(records);
        setClasses([]);
      }

      if (showLoader) setLoading(false);
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleStatus = (item: TeacherClass) => {
    const nextStatus = item.status === 'open' ? 'closed' : 'open';
    if (nextStatus === 'open' && isEventPastGrace({ end_time: item.endTime })) {
      Alert.alert(
        'Cannot reopen',
        `This event ended more than ${EVENT_GRACE_MINUTES} minutes ago. Edit the end time first.`
      );
      return;
    }
    Alert.alert(
      nextStatus === 'closed' ? 'Close event?' : 'Reopen event?',
      nextStatus === 'closed'
        ? 'Students will no longer be able to record attendance.'
        : 'Students will be able to scan the event QR again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'closed' ? 'Close' : 'Reopen',
          style: nextStatus === 'closed' ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await setEventStatus(item.eventId, nextStatus);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            await load(false);
          },
        },
      ]
    );
  };

  const handleMark = async (
    item: TeacherClass,
    student: RosterStudent,
    status: AttendanceStatus
  ) => {
    if (markingKey) return;

    setMarkingKey(`${item.eventId}:${student.studentId}`);
    const result = await markAttendance(
      item.eventId,
      student.studentId,
      status
    );

    if (!result.success) {
      Alert.alert('Error', result.message);
    } else {
      setClasses((current) =>
        current.map((entry) =>
          entry.eventId === item.eventId
            ? withCounts({
                ...entry,
                students: entry.students.map((row) =>
                  row.studentId === student.studentId
                    ? {
                        ...row,
                        status,
                        scannedAt: row.scannedAt ?? new Date().toISOString(),
                      }
                    : row
                ),
              })
            : entry
        )
      );
    }

    setMarkingKey(null);
  };

  const handleMarkAll = (item: TeacherClass) => {
    if (markingKey) return;

    Alert.alert(
      'Mark everyone present?',
      'Students without a record will be marked present. Existing records will not change.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark all',
          onPress: async () => {
            setMarkingKey(`${item.eventId}:all`);
            const result = await markAllPresent(item.eventId);

            if (!result.success) {
              Alert.alert('Error', result.message);
            } else {
              await load(false);
            }

            setMarkingKey(null);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.muted}>Loading records...</Text>
      </View>
    );
  }

  if (role === 'teacher') {
    if (classes.length === 0) {
      return (
        <View style={styles.centered}>
          <Ionicons
            name="calendar-outline"
            size={44}
            color={COLORS.textSecondary}
          />
          <Text style={styles.title}>No classes yet</Text>
          <Text style={styles.muted}>
            Create an event in the Events tab to see the class roster and mark
            attendance.
          </Text>
          <Pressable
            style={styles.emptyButton}
            onPress={() => router.push('/teacher')}
          >
            <Text style={styles.emptyButtonText}>Create an event</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={classes}
        keyExtractor={(item) => item.eventId}
        ListHeaderComponent={
          <View style={styles.screenHeader}>
            <Text style={styles.screenTitle}>My Class</Text>
            <Text style={styles.meta}>
              Mark attendance for your events in real time.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const progress =
            item.totalCount === 0
              ? 0
              : Math.round((item.markedCount / item.totalCount) * 100);

          return (
            <View style={styles.classCard}>
              <View style={styles.classTopRow}>
                <View
                  style={[
                    styles.openPill,
                    item.status === 'open'
                      ? styles.openPillOpen
                      : styles.openPillClosed,
                  ]}
                >
                  <Text style={styles.openPillText}>
                    {item.status === 'open' ? 'OPEN NOW' : 'CLOSED'}
                  </Text>
                </View>
                <Text style={styles.eventCode}>{item.eventCode}</Text>
              </View>

              <Text style={styles.classTitle}>{item.title}</Text>
              <Text style={styles.meta}>
                {item.markedCount} of {item.totalCount} students marked
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${progress}%` as `${number}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.classActions}>
                <Pressable
                  style={styles.outlineAction}
                  onPress={() => toggleStatus(item)}
                >
                  <Ionicons
                    name={
                      item.status === 'open'
                        ? 'lock-closed-outline'
                        : 'lock-open-outline'
                    }
                    size={15}
                    color={COLORS.textPrimary}
                  />
                  <Text style={styles.outlineActionText}>
                    {item.status === 'open' ? 'Close event' : 'Reopen event'}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.primaryAction}
                  onPress={() =>
                    router.push({
                      pathname: '/event/[id]',
                      params: { id: item.eventId },
                    })
                  }
                >
                  <Ionicons
                    name="qr-code-outline"
                    size={15}
                    color={COLORS.textOnPrimary}
                  />
                  <Text style={styles.primaryActionText}>Show QR code</Text>
                </Pressable>
              </View>

              <View style={styles.breakdownCard}>
                <View style={styles.breakdownHeader}>
                  <Text style={styles.breakdownTitle}>
                    Attendance breakdown
                  </Text>
                  <Text style={styles.meta}>
                    {item.markedCount} record
                    {item.markedCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <View style={styles.breakdownRow}>
                  <BreakdownItem
                    color={COLORS.success}
                    label="Present"
                    value={item.presentCount}
                  />
                  <BreakdownItem
                    color={COLORS.warning}
                    label="Late"
                    value={item.lateCount}
                  />
                  <BreakdownItem
                    color={COLORS.danger}
                    label="Absent"
                    value={item.absentCount}
                  />
                  <BreakdownItem
                    color={COLORS.magenta}
                    label="Excused"
                    value={item.excusedCount}
                  />
                </View>
              </View>

              <View style={styles.markHeader}>
                <Text style={styles.markTitle}>Mark attendance</Text>
                <Pressable
                  disabled={Boolean(markingKey)}
                  onPress={() => handleMarkAll(item)}
                >
                  <Text
                    style={[
                      styles.markAllText,
                      Boolean(markingKey) && styles.disabledText,
                    ]}
                  >
                    {markingKey === `${item.eventId}:all`
                      ? 'Marking…'
                      : 'Mark all present'}
                  </Text>
                </Pressable>
              </View>

              {item.students.length === 0 ? (
                <Text style={styles.muted}>
                  No students on the roster yet. Students are added when they
                  register or scan the QR code.
                </Text>
              ) : (
                item.students.map((student) => {
                  const key = `${item.eventId}:${student.studentId}`;
                  const busy = markingKey === key;

                  return (
                    <View key={student.studentId} style={styles.studentCard}>
                      <View style={styles.studentTopRow}>
                        <View
                          style={[
                            styles.avatar,
                            {
                              borderColor: student.status
                                ? STATUS_COLORS[student.status]
                                : COLORS.border,
                            },
                          ]}
                        >
                          <Text style={styles.avatarText}>
                            {initials(student)}
                          </Text>
                        </View>
                        <View style={styles.studentInfo}>
                          <Text style={styles.studentName} numberOfLines={1}>
                            {student.studentName ||
                              student.studentEmail ||
                              shortId(student.studentId)}
                          </Text>
                          <Text style={styles.meta}>
                            {studentMeta(student)}
                          </Text>
                        </View>
                        {student.status ? (
                          <View
                            style={[
                              styles.statusPill,
                              {
                                borderColor:
                                  STATUS_COLORS[student.status] ??
                                  COLORS.border,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusPillText,
                                {
                                  color:
                                    STATUS_COLORS[student.status] ??
                                    COLORS.textSecondary,
                                },
                              ]}
                            >
                              {student.status.toUpperCase()}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.statusButtons}>
                        {ATTENDANCE_STATUSES.map((status) => {
                          const active = student.status === status;
                          return (
                            <Pressable
                              key={status}
                              disabled={Boolean(markingKey)}
                              onPress={() =>
                                handleMark(item, student, status)
                              }
                              style={[
                                styles.statusButton,
                                active && {
                                  backgroundColor: `${STATUS_COLORS[status]}22`,
                                  borderColor: STATUS_COLORS[status],
                                },
                                Boolean(markingKey) && styles.disabled,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusButtonText,
                                  active && {
                                    color: STATUS_COLORS[status],
                                  },
                                ]}
                              >
                                {busy
                                  ? '…'
                                  : status.charAt(0).toUpperCase() +
                                    status.slice(1)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          );
        }}
      />
    );
  }

  if (studentRecords.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>No records yet</Text>
        <Text style={styles.muted}>
          Scan an event QR code to record your attendance.
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={studentRecords}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{item.eventTitle}</Text>
            <StatusPill status={item.status} />
          </View>
          <Text style={styles.meta}>{item.eventCode}</Text>
          {item.venue ? (
            <Text style={styles.meta}>{item.venue}</Text>
          ) : null}
          <Text style={styles.meta}>
            {new Date(item.scannedAt).toLocaleString()}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  listContent: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  screenHeader: {
    gap: 2,
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  classCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 10,
  },
  classTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  openPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  openPillOpen: {
    borderColor: COLORS.success,
    backgroundColor: `${COLORS.success}22`,
  },
  openPillClosed: {
    borderColor: COLORS.muted,
    backgroundColor: `${COLORS.muted}22`,
  },
  openPillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: COLORS.textPrimary,
  },
  eventCode: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  classTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: COLORS.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  classActions: {
    flexDirection: 'row',
    gap: 10,
  },
  outlineAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
  },
  outlineActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  primaryAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: COLORS.primary,
  },
  primaryActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textOnPrimary,
  },
  breakdownCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  breakdownTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  breakdownLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  markHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 4,
  },
  markTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  markAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.accent,
  },
  disabledText: {
    opacity: 0.5,
  },
  studentCard: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    gap: 10,
  },
  studentTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  studentInfo: {
    flex: 1,
    gap: 1,
  },
  studentName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statusButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  statusButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: COLORS.card,
  },
  statusButtonText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 4,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
    flex: 1,
  },
  countBadge: {
    minWidth: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  countText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  meta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  muted: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  emptyButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  disabled: {
    opacity: 0.5,
  },
});
