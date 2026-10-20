import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth, signOut } from '@/lib/auth';
import { getProfile, updateProfile, type Profile } from '@/lib/profiles';

export default function ProfileScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draftName, setDraftName] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!user) return;
    const p = await getProfile(user.id);
    setProfile(p);
    setDraftName(p?.full_name ?? '');
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleSaveName = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await updateProfile(user.id, {
      full_name: draftName.trim(),
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', error);
    } else {
      // Re-read from the cloud so the screen always shows the saved value,
      // even for accounts whose profile row did not exist before.
      await loadProfile();
      setEditing(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace('/login');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Profile</Text>

      {profile?.role === 'teacher' ? (
        <View style={styles.roleBadge}>
          <Text style={styles.roleBadgeText}>Teacher</Text>
        </View>
      ) : profile?.role === 'admin' ? (
        <View style={[styles.roleBadge, styles.roleBadgeAdmin]}>
          <Text style={styles.roleBadgeTextDark}>Administrator</Text>
        </View>
      ) : (
        <View style={[styles.roleBadge, styles.roleBadgeStudent]}>
          <Text style={styles.roleBadgeTextDark}>Student</Text>
        </View>
      )}

      {profile && !profile.is_active ? (
        <Text style={styles.inactiveText}>
          This account is deactivated.
        </Text>
      ) : null}

      <View style={styles.infoCard}>
        <Text style={styles.label}>Name</Text>
        {editing ? (
          <View style={styles.nameEditRow}>
            <TextInput
              style={styles.nameInput}
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Your name"
              placeholderTextColor={COLORS.muted}
              editable={!saving}
            />
            <Pressable
              style={styles.saveButton}
              onPress={handleSaveName}
              disabled={saving}
            >
              <Text style={styles.saveText}>
                {saving ? 'Saving...' : 'Save'}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setEditing(true)} style={styles.nameRow}>
            <Text style={styles.value}>
              {profile?.full_name || 'Tap to add your name'}
            </Text>
            <Text style={styles.editHint}>Edit</Text>
          </Pressable>
        )}

        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? profile?.email}</Text>

        <Text style={styles.label}>User ID</Text>
        <Text style={styles.valueSmall}>{user?.id}</Text>
      </View>

      {saving && (
        <ActivityIndicator color={COLORS.primary} style={{ marginBottom: 8 }} />
      )}

      <AppButton
        title="Sign Out"
        icon="log-out-outline"
        onPress={handleSignOut}
        disabled={signingOut}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 12,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 16,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  roleBadgeStudent: {
    backgroundColor: COLORS.accent,
    shadowColor: '#06B6D4',
  },
  roleBadgeAdmin: {
    backgroundColor: COLORS.warning,
    shadowColor: '#FBBF24',
  },
  inactiveText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.danger,
    marginBottom: 12,
  },
  roleBadgeText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 13,
  },
  roleBadgeTextDark: {
    color: '#0B0813',
    fontWeight: '700',
    fontSize: 13,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 4,
    marginTop: 8,
  },
  value: {
    fontSize: 15,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  valueSmall: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editHint: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.accent,
  },
  nameEditRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#A78BFA',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  saveText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
});
