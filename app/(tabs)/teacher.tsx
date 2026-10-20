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
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import {
  closeExpiredEvents,
  createEvent,
  EVENT_GRACE_MINUTES,
  getAllEvents,
  getEventsByTeacher,
  isEventPastGrace,
  setEventStatus,
  type CloudEvent,
} from '@/lib/events';
import {
  EVENT_LATE_MINUTES,
  getAllAttendance,
} from '@/lib/attendance';

function newEventCode() {
  return `EVT-${Date.now().toString(36).toUpperCase()}`;
}

export default function TeacherScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [events, setEvents] = useState<CloudEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const [title, setTitle] = useState('');
  const [eventCode, setEventCode] = useState(() => newEventCode());
  const [description, setDescription] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 60 * 60 * 1000)
  );
  const [editTarget, setEditTarget] = useState<'start' | 'end' | null>(null);
  const [editingPart, setEditingPart] = useState<'date' | 'time'>('date');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    const profile = await getProfile(user.id);
    const currentRole = profile?.role ?? 'student';
    setRole(currentRole);

    if (currentRole === 'teacher' || currentRole === 'admin') {
      await closeExpiredEvents();
      const [list, attendance] = await Promise.all([
        currentRole === 'admin'
          ? getAllEvents()
          : getEventsByTeacher(user.id),
        getAllAttendance(),
      ]);
      setEvents(list);
      const nextCounts: Record<string, number> = {};
      attendance.forEach((row) => {
        nextCounts[row.eventId] = (nextCounts[row.eventId] ?? 0) + 1;
      });
      setCounts(nextCounts);
    } else {
      setEvents([]);
    }
    setRoleLoading(false);
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onPickerChange = (
    event: DateTimePickerEvent,
    selected?: Date
  ) => {
    if (event.type === 'dismissed') {
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

  const applyQuickDuration = (minutes: number) => {
    setEndDate(new Date(startDate.getTime() + minutes * 60 * 1000));
  };

  const handleCreateEvent = async () => {
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
    const { error } = await createEvent({
      event_code: eventCode,
      title,
      description,
      venue,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    });
    setSaving(false);

    if (error) {
      setMessage(
        error.includes('duplicate')
          ? 'That event code is already in use. Try another one.'
          : 'Could not save the event. Please try again.'
      );
      return;
    }

    setMessage('Event created. Open it from the list to show the QR code.');
    setTitle('');
    setDescription('');
    setVenue('');
    setEventCode(newEventCode());
    await load();
  };

  const toggleStatus = (event: CloudEvent) => {
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
        : 'Students will be able to scan the event QR again.',
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

  if (roleLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={COLORS.primary} />
        <Text style={styles.muted}>Checking your account...</Text>
      </View>
    );
  }

  if (role !== 'teacher' && role !== 'admin') {
    return (
      <View style={styles.centered}>
        <Ionicons
          name="lock-closed-outline"
          size={48}
          color={COLORS.textSecondary}
        />
        <Text style={styles.lockTitle}>Teachers Only</Text>
        <Text style={styles.muted}>
          Only teacher and administrator accounts can manage events.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Create Event</Text>

      <Text style={styles.label}>Event Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Founders Day Assembly"
        placeholderTextColor={COLORS.muted}
      />

      <View style={styles.inlineLabelRow}>
        <Text style={styles.label}>Event Code</Text>
        <Pressable onPress={() => setEventCode(newEventCode())}>
          <Text style={styles.generateText}>Generate new code</Text>
        </Pressable>
      </View>
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
        placeholder="School Gymnasium"
        placeholderTextColor={COLORS.muted}
      />

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={description}
        onChangeText={setDescription}
        placeholder="What is this event about?"
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
        <Text style={styles.inputText}>{startDate.toLocaleString()}</Text>
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
      <Text style={styles.hint}>
        Closes automatically {EVENT_GRACE_MINUTES} minutes after the end
        time. Scans more than {EVENT_LATE_MINUTES} minutes after the start
        are marked late.
      </Text>

      {editTarget && (
        <DateTimePicker
          value={editTarget === 'start' ? startDate : endDate}
          mode={Platform.OS === 'android' ? editingPart : 'datetime'}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onPickerChange}
        />
      )}

      <View style={styles.chipRow}>
        <Pressable
          style={styles.chip}
          onPress={() => applyQuickDuration(30)}
        >
          <Text style={styles.chipText}>+30 min</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => applyQuickDuration(60)}
        >
          <Text style={styles.chipText}>+1 hour</Text>
        </Pressable>
        <Pressable
          style={styles.chip}
          onPress={() => applyQuickDuration(120)}
        >
          <Text style={styles.chipText}>+2 hours</Text>
        </Pressable>
      </View>

      <Pressable
        style={[styles.primaryButton, saving && styles.disabled]}
        onPress={handleCreateEvent}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color={COLORS.textOnPrimary} />
        ) : (
          <Text style={styles.primaryButtonText}>Create & Generate QR</Text>
        )}
      </Pressable>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text style={styles.sectionTitle}>
        {role === 'admin' ? 'All Events' : 'My Events'}
      </Text>

      {events.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No events yet</Text>
          <Text style={styles.muted}>
            Create your first event above. It will appear here with its QR
            code and attendance count.
          </Text>
        </View>
      ) : (
        events.map((event) => (
          <View key={event.id} style={styles.eventCard}>
            <View style={styles.eventHeader}>
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
                {new Date(event.start_time).toLocaleString()}
              </Text>
            ) : null}
            {event.venue ? (
              <Text style={styles.meta}>{event.venue}</Text>
            ) : null}
            <View style={styles.eventFooter}>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>
                  {counts[event.id] ?? 0} scanned
                </Text>
              </View>
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.actionButton}
                  onPress={() =>
                    router.push(`/event/${event.id}` as any)
                  }
                >
                  <Ionicons
                    name="qr-code-outline"
                    size={16}
                    color={COLORS.textPrimary}
                  />
                  <Text style={styles.actionText}>View / QR</Text>
                </Pressable>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => toggleStatus(event)}
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
                  <Text style={styles.actionText}>
                    {event.status === 'open' ? 'Close' : 'Reopen'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: 24,
    paddingBottom: 48,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 16,
  },
  lockTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  muted: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginTop: 10,
  },
  inlineLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  generateText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.accent,
    marginTop: 10,
  },
  input: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: COLORS.textPrimary,
  },
  multiline: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  inputText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.textSecondary,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  primaryButton: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: '#A78BFA',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  },
  disabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  message: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 12,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 18,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  eventCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 4,
    marginBottom: 12,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventTitle: {
    flex: 1,
    fontSize: 16,
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
  eventFooter: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  countBadge: {
    backgroundColor: '#8B5CF622',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
});
