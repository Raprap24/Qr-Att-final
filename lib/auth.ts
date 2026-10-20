import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { getProfile } from './profiles';
import type { Session, User } from '@supabase/supabase-js';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};

let globalSession: Session | null = null;
let globalUser: User | null = null;
let globalLoading = true;
let initialized = false;
let listeners: Set<() => void> = new Set();

function notify() {
  listeners.forEach((l) => l());
}

async function initAuth() {
  if (initialized) return;
  initialized = true;
  try {
    const { data } = await supabase.auth.getSession();
    globalSession = data.session;
    globalUser = data.session?.user ?? null;
  } catch {
    globalSession = null;
    globalUser = null;
  } finally {
    globalLoading = false;
    notify();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    globalSession = session;
    globalUser = session?.user ?? null;
    globalLoading = false;
    notify();
  });
}

export function setAuth(session: Session | null) {
  globalSession = session;
  globalUser = session?.user ?? null;
  globalLoading = false;
  notify();
}

export function useAuth(): AuthState {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    initAuth();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    session: globalSession,
    user: globalUser,
    loading: globalLoading,
  };
}

export type SignUpProfile = {
  full_name: string;
};

export async function signUp(
  email: string,
  password: string,
  profile?: SignUpProfile
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: profile?.full_name ?? '',
        // Accounts always start as students. Only an administrator can
        // promote a user to teacher or admin afterwards.
        role: 'student',
      },
    },
  });

  if (!error && data.session) {
    setAuth(data.session);
  }
  return { data, error };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { data, error };
  }

  if (data.user) {
    const profile = await getProfile(data.user.id);
    if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      setAuth(null);
      return {
        data,
        error: {
          message: 'Your account has been deactivated. Contact an administrator.',
        } as any,
      };
    }
  }

  if (data.session) {
    setAuth(data.session);
  }
  return { data, error: null };
}

export async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore network errors on logout; the local session is cleared below.
  }
  setAuth(null);
}
