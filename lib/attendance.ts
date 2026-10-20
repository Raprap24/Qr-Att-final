import { supabase } from './supabase';
import { parseQRPayload } from './qr';
import type { EventStatus } from './events';

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export const EVENT_LATE_MINUTES = 15;

export type AttendanceRecord = {
  id: string;
  eventId: string;
  eventCode: string;
  eventTitle: string;
  venue: string | null;
  status: AttendanceStatus;
  scannedAt: string;
};

export type RegisterResult = {
  success: boolean;
  message: string;
  eventTitle?: string;
  status?: AttendanceStatus;
};

export type Attendee = {
  attendanceId: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  status: AttendanceStatus;
  scannedAt: string;
  notes: string | null;
};

export type RosterStudent = {
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  status: AttendanceStatus | null;
  scannedAt: string | null;
  notes: string | null;
};

export type MarkAttendanceResult = {
  success: boolean;
  message: string;
  count?: number;
};

export type TeacherEventAttendance = {
  eventId: string;
  eventCode: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  status: EventStatus;
  attendeeCount: number;
  attendees: Attendee[];
};

export type TeacherEventSummary = {
  eventId: string;
  eventCode: string;
  title: string;
  status: EventStatus;
  attendeeCount: number;
};

export type TeacherClass = {
  eventId: string;
  eventCode: string;
  title: string;
  venue: string | null;
  status: EventStatus;
  startTime: string | null;
  endTime: string | null;
  students: RosterStudent[];
  presentCount: number;
  lateCount: number;
  absentCount: number;
  excusedCount: number;
  markedCount: number;
  totalCount: number;
};

export type AdminAttendanceRecord = {
  id: string;
  studentId: string;
  studentName: string | null;
  studentEmail: string | null;
  eventId: string;
  eventTitle: string;
  eventCode: string;
  status: AttendanceStatus;
  scannedAt: string;
  notes: string | null;
};

export async function registerAttendance(
  rawPayload: string
): Promise<RegisterResult> {
  const parsed = parseQRPayload(rawPayload);
  if (!parsed.ok) {
    return { success: false, message: parsed.message };
  }

  const { data, error } = await supabase.rpc('record_attendance', {
    p_event_code: parsed.payload.event,
    p_qr_token: parsed.payload.token,
  });

  if (error) {
    return {
      success: false,
      message: error.message || 'Could not record attendance.',
    };
  }

  const result = (data ?? {}) as {
    success?: boolean;
    message?: string;
    event_title?: string;
    status?: AttendanceStatus;
  };

  return {
    success: Boolean(result.success),
    message: result.message ?? 'Attendance could not be recorded.',
    eventTitle: result.event_title,
    status: result.status,
  };
}

export async function getAttendanceHistory(
  studentId: string
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(
      'id, scanned_at, status, events ( id, event_code, title, venue )'
    )
    .eq('student_id', studentId)
    .order('scanned_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row: any) => ({
    id: row.id,
    eventId: row.events?.event_code ?? '',
    eventCode: row.events?.event_code ?? '',
    eventTitle: row.events?.title ?? '',
    venue: row.events?.venue ?? null,
    status: (row.status ?? 'present') as AttendanceStatus,
    scannedAt: row.scanned_at,
  }));
}

async function getProfilesByIds(ids: string[]) {
  const map: Record<string, { full_name: string | null; email: string | null }> =
    {};
  if (ids.length === 0) return map;

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', ids);

  ((data as any[] | null) ?? []).forEach((p: any) => {
    map[p.id] = { full_name: p.full_name ?? null, email: p.email ?? null };
  });

  return map;
}

export async function getTeacherEventAttendance(
  teacherId: string
): Promise<TeacherEventAttendance[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select(
      'id, event_code, title, start_time, end_time, status'
    )
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events) return [];

  const eventIds = events.map((e: any) => e.id);
  if (eventIds.length === 0) return [];

  const { data: attendance, error: attError } = await supabase
    .from('attendance')
    .select('id, student_id, scanned_at, event_id, status, notes')
    .in('event_id', eventIds)
    .order('scanned_at', { ascending: false });

  const rows = attError || !attendance ? [] : (attendance as any[]);
  const studentIds = [...new Set(rows.map((a) => a.student_id))];
  const nameMap = await getProfilesByIds(studentIds);

  return events.map((e: any) => {
    const eventRows = rows.filter((a) => a.event_id === e.id);
    return {
      eventId: e.id,
      eventCode: e.event_code,
      title: e.title,
      startTime: e.start_time,
      endTime: e.end_time,
      status: (e.status ?? 'open') as EventStatus,
      attendeeCount: eventRows.length,
      attendees: eventRows.map((a) => ({
        attendanceId: a.id,
        studentId: a.student_id,
        studentName: nameMap[a.student_id]?.full_name ?? null,
        studentEmail: nameMap[a.student_id]?.email ?? null,
        status: (a.status ?? 'present') as AttendanceStatus,
        scannedAt: a.scanned_at,
        notes: a.notes ?? null,
      })),
    };
  });
}

export async function getTeacherClasses(
  teacherId: string
): Promise<TeacherClass[]> {
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, event_code, title, venue, start_time, end_time, status')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (eventError || !events || events.length === 0) {
    return [];
  }

  const eventIds = events.map((event: any) => event.id as string);

  const [{ data: roster }, { data: attendance }] = await Promise.all([
    supabase
      .from('event_students')
      .select('event_id, student_id')
      .in('event_id', eventIds),
    supabase
      .from('attendance')
      .select('event_id, student_id, status, scanned_at, notes')
      .in('event_id', eventIds),
  ]);

  const rosterRows = (roster as any[] | null) ?? [];
  const attendanceRows = (attendance as any[] | null) ?? [];
  const studentIds = [
    ...new Set(rosterRows.map((row) => row.student_id as string)),
  ];
  const nameMap = await getProfilesByIds(studentIds);

  const attendanceMap = new Map<string, any>();
  attendanceRows.forEach((row) => {
    attendanceMap.set(`${row.event_id}:${row.student_id}`, row);
  });

  const rosterByEvent = new Map<string, string[]>();
  rosterRows.forEach((row) => {
    const list = rosterByEvent.get(row.event_id) ?? [];
    list.push(row.student_id);
    rosterByEvent.set(row.event_id, list);
  });

  const classes = events.map((event: any) => {
    const students: RosterStudent[] = (rosterByEvent.get(event.id) ?? [])
      .map((studentId) => {
        const record = attendanceMap.get(`${event.id}:${studentId}`);
        return {
          studentId,
          studentName: nameMap[studentId]?.full_name ?? null,
          studentEmail: nameMap[studentId]?.email ?? null,
          status: (record?.status ?? null) as AttendanceStatus | null,
          scannedAt: (record?.scanned_at ?? null) as string | null,
          notes: (record?.notes ?? null) as string | null,
        };
      })
      .sort((a, b) =>
        (a.studentName ?? a.studentEmail ?? a.studentId).localeCompare(
          b.studentName ?? b.studentEmail ?? b.studentId
        )
      );

    const presentCount = students.filter(
      (student) => student.status === 'present'
    ).length;
    const lateCount = students.filter(
      (student) => student.status === 'late'
    ).length;
    const absentCount = students.filter(
      (student) => student.status === 'absent'
    ).length;
    const excusedCount = students.filter(
      (student) => student.status === 'excused'
    ).length;

    return {
      eventId: event.id as string,
      eventCode: event.event_code as string,
      title: event.title as string,
      venue: (event.venue ?? null) as string | null,
      status: (event.status ?? 'open') as EventStatus,
      startTime: (event.start_time ?? null) as string | null,
      endTime: (event.end_time ?? null) as string | null,
      students,
      presentCount,
      lateCount,
      absentCount,
      excusedCount,
      markedCount: students.filter((student) => student.status !== null)
        .length,
      totalCount: students.length,
    };
  });

  return classes.sort((a, b) => {
    if (a.status === b.status) return 0;
    return a.status === 'open' ? -1 : 1;
  });
}

export async function getEventAttendance(
  eventId: string
): Promise<Attendee[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('id, student_id, scanned_at, status, notes')
    .eq('event_id', eventId)
    .order('scanned_at', { ascending: false });

  if (error || !data) return [];

  const rows = data as any[];
  const studentIds = [...new Set(rows.map((a) => a.student_id))];
  const nameMap = await getProfilesByIds(studentIds);

  return rows.map((a) => ({
    attendanceId: a.id,
    studentId: a.student_id,
    studentName: nameMap[a.student_id]?.full_name ?? null,
    studentEmail: nameMap[a.student_id]?.email ?? null,
    status: (a.status ?? 'present') as AttendanceStatus,
    scannedAt: a.scanned_at,
    notes: a.notes ?? null,
  }));
}

export async function getEventRoster(
  eventId: string
): Promise<RosterStudent[]> {
  const { data: roster, error } = await supabase
    .from('event_students')
    .select('student_id')
    .eq('event_id', eventId);

  if (error || !roster) return [];

  const studentIds = roster.map((row: any) => row.student_id as string);

  const [{ data: attendance }, nameMap] = await Promise.all([
    supabase
      .from('attendance')
      .select('student_id, status, scanned_at, notes')
      .eq('event_id', eventId),
    getProfilesByIds(studentIds),
  ]);

  const attendanceByStudent = new Map<string, any>();
  ((attendance as any[] | null) ?? []).forEach((row) => {
    attendanceByStudent.set(row.student_id, row);
  });

  return studentIds
    .map((studentId) => {
      const record = attendanceByStudent.get(studentId);
      return {
        studentId,
        studentName: nameMap[studentId]?.full_name ?? null,
        studentEmail: nameMap[studentId]?.email ?? null,
        status: (record?.status ?? null) as AttendanceStatus | null,
        scannedAt: (record?.scanned_at ?? null) as string | null,
        notes: (record?.notes ?? null) as string | null,
      };
    })
    .sort((a, b) =>
      (a.studentName ?? a.studentEmail ?? a.studentId).localeCompare(
        b.studentName ?? b.studentEmail ?? b.studentId
      )
    );
}

export async function markAttendance(
  eventId: string,
  studentId: string,
  status: AttendanceStatus
): Promise<MarkAttendanceResult> {
  const { data, error } = await supabase.rpc('mark_attendance', {
    p_event_id: eventId,
    p_student_id: studentId,
    p_status: status,
  });

  if (error) {
    return { success: false, message: error.message };
  }

  const result = (data ?? {}) as Partial<MarkAttendanceResult>;
  return {
    success: Boolean(result.success),
    message: result.message ?? 'Could not update attendance.',
  };
}

export async function markAllPresent(
  eventId: string
): Promise<MarkAttendanceResult> {
  const { data, error } = await supabase.rpc('mark_all_present', {
    p_event_id: eventId,
  });

  if (error) {
    return { success: false, message: error.message };
  }

  const result = (data ?? {}) as Partial<MarkAttendanceResult>;
  return {
    success: Boolean(result.success),
    message: result.message ?? 'Could not update attendance.',
    count: result.count,
  };
}

export async function getAllAttendance(): Promise<AdminAttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select(
      'id, student_id, event_id, status, scanned_at, notes, events ( id, event_code, title )'
    )
    .order('scanned_at', { ascending: false });

  if (error || !data) return [];

  const rows = data as any[];
  const studentIds = [...new Set(rows.map((a) => a.student_id))];
  const nameMap = await getProfilesByIds(studentIds);

  return rows.map((a) => ({
    id: a.id,
    studentId: a.student_id,
    studentName: nameMap[a.student_id]?.full_name ?? null,
    studentEmail: nameMap[a.student_id]?.email ?? null,
    eventId: a.event_id,
    eventTitle: a.events?.title ?? '',
    eventCode: a.events?.event_code ?? '',
    status: (a.status ?? 'present') as AttendanceStatus,
    scannedAt: a.scanned_at,
    notes: a.notes ?? null,
  }));
}

export async function updateAttendance(
  attendanceId: string,
  updates: { status?: AttendanceStatus; notes?: string | null }
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('attendance')
    .update(updates)
    .eq('id', attendanceId);

  return { error: error?.message ?? null };
}

export async function deleteAttendance(
  attendanceId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('attendance')
    .delete()
    .eq('id', attendanceId);

  return { error: error?.message ?? null };
}
