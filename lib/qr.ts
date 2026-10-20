export type QRPayload = {
  v: 2;
  event: string;
  token: string;
  title?: string;
  start?: string;
  end?: string;
};

export function buildQRPayload(event: {
  eventId: string;
  token: string;
  title: string;
  start?: string;
  end?: string;
}): string {
  const payload: QRPayload = {
    v: 2,
    event: event.eventId,
    token: event.token,
  };

  if (event.title) payload.title = event.title;
  if (event.start) payload.start = event.start;
  if (event.end) payload.end = event.end;

  return JSON.stringify(payload);
}

export type ParseQRResult =
  | { ok: true; payload: QRPayload }
  | { ok: false; message: string };

export function parseQRPayload(raw: string): ParseQRResult {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'Invalid QR code.' };
  }

  if (
    parsed.v !== 2 ||
    typeof parsed.event !== 'string' ||
    !parsed.event ||
    typeof parsed.token !== 'string' ||
    !parsed.token
  ) {
    return { ok: false, message: 'Not an attendance QR code.' };
  }

  return { ok: true, payload: parsed as QRPayload };
}
