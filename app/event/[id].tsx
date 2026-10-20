import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import QRCode from 'react-native-qrcode-svg';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import {
  closeExpiredEvents,
  deleteEvent,
  EVENT_GRACE_MINUTES,
  getEventById,
  getEventToken,
  isEventPastGrace,
  setEventStatus,
  updateEvent,
  type CloudEvent,
} from '@/lib/events';
import {
  getEventRoster,
  markAllPresent,
  markAttendance,
  type AttendanceStatus,
  type RosterStudent,
} from '@/lib/attendance';
import { buildQRPayload } from '@/lib/qr';

const STATUS_COLORS: Record<string, string> = {
  present: COLORS.success,
  late: COLORS.warning,
  absent: COLORS.danger,
  excused: COLORS.accent,
};

const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'absent',
  'excused',
];

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [event, setEvent] = useState<CloudEvent | null>(null);
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [eventCode, setEventCode] = useState('');
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [editTarget, setEditTarget] = useState<'start' | 'end' | null>(null);
  const [editingPart, setEditingPart] = useState<'date' | 'time'>('date');

  const load = useCallback(async () => {
    if (!user || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setUnauthorized(false);

    const profile = await getProfile(user.id);
    const currentRole = profile?.role ?? 'student';
    setRole(currentRole);

    if (currentRole === 'teacher' || currentRole === 'admin') {
      await closeExpiredEvents();
    }

    const found = await getEventById(String(id));
    if (!found) {
      setEvent(null);
      setLoading(false);
      return;
    }

    const allowed =
      currentRole === 'admin' ||
      (currentRole === 'teacher' && found.created_by === user.id);

    if (!allowed) {
      setUnauthorized(true);
      setEvent(null);
      setLoading(false);
      return;
    }

    setEvent(found);
    setTitle(found.title);
    setEventCode(found.event_code);
    setDescription(found.description ?? '');
    setVenue(found.venue ?? '');
    if (found.start_time) setStartDate(new Date(found.start_time));
    if (found.end_time) setEndDate(new Date(found.end_time));

    const [token, list] = await Promise.all([
      getEventToken(found.id),
      getEventRoster(found.id),
    ]);
    setQrToken(token);
    setRoster(list);
    setLoading(false);
  }, [user, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onPickerChange = (
    pickerEvent: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (pickerEvent.type === 'dismissed') {
      setEditTarget(null);
      return;
    }
    if (selected) {
      if (editTarget === 'start') setStartDate(selected);
      if (editTarget === 'end') setEndDate(selected);
    }
    if (Platform.OS === 'android' && editingPart === 'date') {
      setEditingPart('time');
    } else {
      setEditTarget(null);
      setEditingPart('date');
    }
  };

  const handleSave = async () => {
    if (!event) return;
    setMessage(null);
    if (!title.trim() || !eventCode.trim()) {
      setMessage('Event title and code are required.');
      return;
    }
    if (startDate >= endDate) {
      setMessage('Start time must be before end time.');
      return;
    }

    setSaving(true);
    const { error } = await updateEvent(event.id, {
      title,
      event_code: eventCode,
      description,
      venue,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    });
    setSaving(false);

    if (error) {
      setMessage('Could not save changes. Please try again.');
      return;
    }

    setEditing(false);
    setMessage('Event updated.');
    await load();
  };

  const toggleStatus = () => {
    if (!event) return;
    const nextStatus = event.status === 'open' ? 'closed' : 'open';
    if (nextStatus === 'open' && isEventPastGrace(event)) {
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
        : 'Students will be able to scan this event again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: nextStatus === 'closed' ? 'Close' : 'Reopen',
          style: nextStatus === 'closed' ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await setEventStatus(event.id, nextStatus);
            if (error) {
              Alert.alert('Error', error);
            } else {
              await load();
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    if (!event) return;
    Alert.alert(
      'Delete event?',
      'This permanently removes the event and all of its attendance records.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await deleteEvent(event.id);
            if (error) {
              Alert.alert('Error', error);
              return;
            }
            router.back();
          },
        },
      ]
    );
  };

  const handleMark = async (
    studentId: string,
    status: AttendanceStatus
  ) => {
    if (!event || markingId || markingAll) return;

    setMarkingId(studentId);
    const result = await markAttendance(event.id, studentId, status);
    if (!result.success) {
      Alert.alert('Error', result.message);
    } else {
      setRoster(await getEventRoster(event.id));
    }
    setMarkingId(null);
  };

  const handleMarkAll = () => {
    if (!event || markingAll) return;

    Alert.alert(
      'Mark everyone present?',
      'Students without a record will be marked present. Existing records will not change.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark all',
          onPress: async () => {
            setMarkingAll(true);
            const result = await markAllPresent(event.id);
            setMarkingAll(false);

            if (!result.success) {
              Alert.alert('Error', result.message);
              return;
            }

            setRoster(await getEventRoster(event.id));
            setMessage(result.message);
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.muted}>Loading event...</Text>
      </SafeAreaView>
    );
  }

  if (unauthorized) {
    return (
      <SafeAreaView style={styles.centered}>
        <Ionicons
          name="lock-closed-outline"
          size={48}
          color={COLORS.textSecondary}
        />
        <Text style={styles.title}>Access denied</Text>
        <Text style={styles.muted}>
          You can only manage events that belong to your account.
        </Text>
        <Pressable style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.title}>Event not found</Text>
        <Text style={styles.muted}>
          This event may have been deleted.
        </Text>
        <Pressable style={styles.linkButton} onPress={() => router.back()}>
          <Text style={styles.linkText}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const payload = qrToken
    ? buildQRPayload({
        eventId: event.event_code,
        token: qrToken,
        title: event.title,
        start: event.start_time ?? undefined,
        end: event.end_time ?? undefined,
      })
    : null;
  const markedCount = roster.filter(
    (student) => student.status !== null
  ).length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons
              name="arrow-back"
              size={20}
              color={COLORS.textPrimary}
            />
          </Pressable>
          <Text style={styles.topTitle}>Event Details</Text>
          <View style={styles.backButton} />
        </View>

        <View style={styles.eventCard}>
          <View style={styles.row}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <View
              style={[
                styles.statusBadge,
                event.status === 'open'
                  ? styles.statusOpen
                  : styles.statusClosed,
              ]}
            >
              <Text style={styles.statusText}>
                {event.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.meta}>{event.event_code}</Text>
          {event.start_time ? (
            <Text style={styles.meta}>
              Starts: {new Date(event.start_time).toLocaleString()}
            </Text>
          ) : null}
          {event.end_time ? (
            <Text style={styles.meta}>
              Ends: {new Date(event.end_time).toLocaleString()}
            </Text>
          ) : null}
          {event.end_time && event.status === 'open' ? (
            <Text style={styles.meta}>
              Auto-closes {EVENT_GRACE_MINUTES} minutes after the end time.
            </Text>
          ) : null}
          {event.venue ? (
            <Text style={styles.meta}>Venue: {event.venue}</Text>
          ) : null}
          {event.description ? (
            <Text style={styles.description}>{event.description}</Text>
          ) : null}
        </View>

        <View style={styles.qrCard}>
          <Text style={styles.qrTitle}>Event QR Code</Text>
          {payload ? (
            <>
              <QRCode value={payload} size={220} />
              <Text style={styles.payloadText}>{payload}</Text>
            </>
          ) : (
            <Text style={styles.qrMissing}>
              QR token unavailable. Re-create the event or refresh.
            </Text>
          )}
          <Text style={styles.qrHint}>
            Students scan this code from the Scan tab.
          </Text>
        </View>

        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryButton} onPress={toggleStatus}>
            <Ionicons
              name={
                event.status === 'open'
                  ? 'lock-closed-outline'
                  : 'lock-open-outline'
              }
              size={18}
              color={COLORS.textPrimary}
            />
            <Text style={styles.secondaryText}>
              {event.status === 'open' ? 'Close Event' : 'Reopen Event'}
            </Text>
          </Pressable>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => {
              setEditing((value) => !value);
              setMessage(null);
            }}
          >
            <Ionicons
              name={editing ? 'close-outline' : 'create-outline'}
              size={18}
              color={COLORS.textPrimary}
            />
            <Text style={styles.secondaryText}>
              {editing ? 'Cancel Edit' : 'Edit Event'}
            </Text>
          </Pressable>
        </View>

        {editing ? (
          <View style={styles.editCard}>
            <Text style={styles.sectionTitle}>Edit Event</Text>

            <Text style={styles.label}>Event Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Event title"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Event Code</Text>
            <TextInput
              style={styles.input}
              value={eventCode}
              onChangeText={setEventCode}
              placeholder="EVT-2026-0001"
              placeholderTextColor={COLORS.muted}
              autoCapitalize="characters"
            />

            <Text style={styles.label}>Venue</Text>
            <TextInput
              style={styles.input}
              value={venue}
              onChangeText={setVenue}
              placeholder="Venue"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Description"
              placeholderTextColor={COLORS.muted}
              multiline
            />

            <Text style={styles.label}>Start Time</Text>
            <Pressable
              style={styles.input}
              onPress={() => {
                setEditTarget('start');
                setEditingPart('date');
              }}
            >
              <Text style={styles.inputText}>
                {startDate.toLocaleString()}
              </Text>
            </Pressable>

            <Text style={styles.label}>End Time</Text>
            <Pressable
              style={styles.input}
              onPress={() => {
                setEditTarget('end');
                setEditingPart('date');
              }}
            >
              <Text style={styles.inputText}>{endDate.toLocaleString()}</Text>
            </Pressable>

            {editTarget && (
              <DateTimePicker
                value={editTarget === 'start' ? startDate : endDate}
                mode={Platform.OS === 'android' ? editingPart : 'datetime'}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPickerChange}
              />
            )}

            <Pressable
              style={[styles.primaryButton, saving && styles.disabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={COLORS.textOnPrimary} />
              ) : (
                <Text style={styles.primaryText}>Save Changes</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <View style={styles.attendanceHeader}>
          <Text style={styles.sectionTitle}>
            Attendance ({markedCount}/{roster.length} marked)
          </Text>
          {roster.length > 0 ? (
            <Pressable
              style={[
                styles.markAllButton,
                (markingAll || Boolean(markingId)) && styles.disabled,
              ]}
              onPress={handleMarkAll}
              disabled={markingAll || Boolean(markingId)}
            >
              {markingAll ? (
                <ActivityIndicator size="small" color={COLORS.accent} />
              ) : (
                <Text style={styles.markAllText}>Mark all present</Text>
              )}
            </Pressable>
          ) : null}
        </View>
        {roster.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>
              No students are on this event&apos;s roster yet. Students are
              added automatically when they register or scan the QR code.
            </Text>
          </View>
        ) : (
          roster.map((student) => (
            <View key={student.studentId} style={styles.attendeeCard}>
              <View style={styles.row}>
                <Text style={styles.attendeeName}>
                  {student.studentName ||
                    student.studentEmail ||
                    `Student ${student.studentId.slice(0, 8)}`}
                </Text>
                <View
                  style={[
                    styles.statusPill,
                    {
                      borderColor: student.status
                        ? STATUS_COLORS[student.status] ?? COLORS.border
                        : COLORS.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      {
                        color: student.status
                          ? STATUS_COLORS[student.status] ??
                            COLORS.textSecondary
                          : COLORS.textSecondary,
                      },
                    ]}
                  >
                    {student.status
                      ? student.status.toUpperCase()
                      : 'NO RECORD'}
                  </Text>
                </View>
              </View>
              <Text style={styles.meta}>
                {student.studentEmail ?? 'No email on file'}
              </Text>
              {student.scannedAt ? (
                <Text style={styles.meta}>
                  {new Date(student.scannedAt).toLocaleString()}
                </Text>
              ) : null}

              <View style={styles.statusActions}>
                {ATTENDANCE_STATUSES.map((status) => {
                  const active = student.status === status;
                  const disabled =
                    markingId === student.studentId || markingAll;
                  return (
                    <Pressable
                      key={status}
                      disabled={disabled}
                      onPress={() => handleMark(student.studentId, status)}
                      style={[
                        styles.statusAction,
                        active && styles.statusActionActive,
                        active && { borderColor: STATUS_COLORS[status] },
                        disabled && styles.disabled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusActionText,
                          active && { color: STATUS_COLORS[status] },
                        ]}
                      >
                        {status}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {markingId === student.studentId ? (
                <ActivityIndicator size="small" color={COLORS.accent} />
              ) : null}
            </View>
          ))
        )}

        {role === 'admin' ? (
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <Ionicons
              name="trash-outline"
              size={18}
              color={COLORS.textOnPrimary}
            />
            <Text style={styles.deleteText}>Delete Event</Text>
          </Pressable>
        ) : null}
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontSize: 18,
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
  eventCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  eventTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  statusBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusOpen: {
    backgroundColor: COLORS.success,
  },
  statusClosed: {
    backgroundColor: COLORS.muted,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0B0813',
  },
  meta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  description: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textPrimary,
  },
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  qrTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  payloadText: {
    fontSize: 11,
    color: '#4B5563',
  },
  qrHint: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
  qrMissing: {
    fontSize: 13,
    color: '#B91C1C',
    textAlign: 'center',
    paddingVertical: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  editCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  inputText: {
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    color: COLORS.textPrimary,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  primaryText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  message: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
  },
  attendeeCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 3,
  },
  attendeeName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  attendanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  markAllButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markAllText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.accent,
  },
  statusActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  statusAction: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: COLORS.background,
  },
  statusActionActive: {
    backgroundColor: COLORS.surface,
  },
  statusActionText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'capitalize',
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  deleteButton: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.danger,
    borderRadius: 12,
    paddingVertical: 14,
  },
  deleteText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  linkButton: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.accent,
  },
});
