import { supabase } from './supabase';

export type EventStatus = 'open' | 'closed';

export const EVENT_GRACE_MINUTES = 15;

export function isEventPastGrace(event: {
  end_time: string | null;
}): boolean {
  if (!event.end_time) return false;
  const cutoff =
    new Date(event.end_time).getTime() + EVENT_GRACE_MINUTES * 60 * 1000;
  return cutoff < Date.now();
}

export type CloudEvent = {
  id: string;
  event_code: string;
  title: string;
  description: string | null;
  venue: string | null;
  start_time: string | null;
  end_time: string | null;
  status: EventStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventInput = {
  event_code: string;
  title: string;
  description?: string | null;
  venue?: string | null;
  start_time: string;
  end_time: string;
};

export async function createEvent(
  event: EventInput
): Promise<{ event: CloudEvent | null; error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { event: null, error: 'You must be logged in to create an event.' };
  }

  const { data, error } = await supabase
    .from('events')
    .insert({
      event_code: event.event_code.trim(),
      title: event.title.trim(),
      description: event.description?.trim() || null,
      venue: event.venue?.trim() || null,
      start_time: event.start_time,
      end_time: event.end_time,
      status: 'open',
      created_by: user.id,
    })
    .select('*')
    .single();

  return {
    event: (data as CloudEvent) ?? null,
    error: error?.message ?? null,
  };
}

export async function updateEvent(
  eventId: string,
  updates: Partial<EventInput> & { status?: EventStatus }
): Promise<{ event: CloudEvent | null; error: string | null }> {
  const payload: Record<string, unknown> = { ...updates };
  if (typeof updates.event_code === 'string') {
    payload.event_code = updates.event_code.trim();
  }
  if (typeof updates.title === 'string') {
    payload.title = updates.title.trim();
  }
  if (typeof updates.description === 'string' || updates.description === null) {
    payload.description = updates.description?.trim() || null;
  }
  if (typeof updates.venue === 'string' || updates.venue === null) {
    payload.venue = updates.venue?.trim() || null;
  }

  const { data, error } = await supabase
    .from('events')
    .update(payload)
    .eq('id', eventId)
    .select('*')
    .single();

  return {
    event: (data as CloudEvent) ?? null,
    error: error?.message ?? null,
  };
}

export async function setEventStatus(
  eventId: string,
  status: EventStatus
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('events')
    .update({ status })
    .eq('id', eventId);

  return { error: error?.message ?? null };
}

export async function deleteEvent(
  eventId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', eventId);

  return { error: error?.message ?? null };
}

export async function closeExpiredEvents(): Promise<void> {
  const cutoff = new Date(
    Date.now() - EVENT_GRACE_MINUTES * 60 * 1000
  ).toISOString();

  await supabase
    .from('events')
    .update({ status: 'closed' })
    .eq('status', 'open')
    .lt('end_time', cutoff);
}

export async function getEventById(
  eventId: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', eventId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}

export async function getEventToken(
  eventId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('event_qr_tokens')
    .select('token')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return (data as { token: string }).token;
}

export async function getEventsByTeacher(
  teacherId: string
): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('created_by', teacherId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

export async function getAllEvents(): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as CloudEvent[];
}

export async function getOpenEvents(): Promise<CloudEvent[]> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('status', 'open')
    .order('start_time', { ascending: true });

  if (error || !data) {
    return [];
  }

  const now = Date.now();
  const graceMs = EVENT_GRACE_MINUTES * 60 * 1000;
  return (data as CloudEvent[]).filter(
    (event) =>
      !event.end_time ||
      new Date(event.end_time).getTime() + graceMs >= now
  );
}

export async function getEventByCode(
  code: string
): Promise<CloudEvent | null> {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('event_code', code)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as CloudEvent;
}
