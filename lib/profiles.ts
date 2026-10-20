import { supabase } from './supabase';

export type Role = 'student' | 'teacher' | 'admin';

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at?: string;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active, created_at')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as Profile;
}

export async function updateProfile(
  userId: string,
  updates: { full_name?: string }
): Promise<{ error: string | null }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const row: Record<string, unknown> = { id: userId, ...updates };
  if (user?.email) {
    row.email = user.email;
  }

  const { error } = await supabase
    .from('profiles')
    .upsert(row, { onConflict: 'id' });

  return { error: error?.message ?? null };
}

export async function getAllProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active, created_at')
    .order('created_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data as Profile[];
}

export async function setUserRole(
  userId: string,
  role: Role
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);

  return { error: error?.message ?? null };
}

export async function setUserActive(
  userId: string,
  isActive: boolean
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId);

  return { error: error?.message ?? null };
}
