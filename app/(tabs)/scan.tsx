import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import AppButton from '@/components/AppButton';
import { COLORS } from '@/constants/colors';
import { useAuth } from '@/lib/auth';
import { getProfile, type Role } from '@/lib/profiles';
import { registerAttendance } from '@/lib/attendance';

export default function ScanScreen() {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [lastData, setLastData] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileRole, setProfileRole] = useState<Role | null>(null);
  const [identityLoading, setIdentityLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!user) {
      setProfileName(null);
      setProfileRole(null);
      setIdentityLoading(false);
      return;
    }
    setIdentityLoading(true);
    getProfile(user.id).then((profile) => {
      if (!active) return;
      setProfileName(profile?.full_name ?? null);
      setProfileRole(profile?.role ?? null);
      setIdentityLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user]);

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Camera Access Needed</Text>
        <Text style={styles.subtitle}>
          We need camera access to scan attendance QR codes.
        </Text>
        <AppButton
          theme="primary"
          title="Grant Permission"
          icon="camera-outline"
          onPress={requestPermission}
        />
      </View>
    );
  }

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    setLastData(data);

    if (!user) {
      setMessage('Please log in first. Attendance needs an account.');
      setSuccess(false);
      return;
    }
    if (identityLoading) {
      setMessage('Checking your account... please tap Scan Again.');
      setSuccess(false);
      return;
    }
    if (profileRole !== 'student') {
      setMessage(
        'Only student accounts can record attendance. Log in with a student account to scan.'
      );
      setSuccess(false);
      return;
    }

    registerAttendance(data)
      .then((result) => {
        const base =
          result.success && result.eventTitle
            ? `Attendance recorded for ${result.eventTitle}!`
            : result.message;
        const suffix =
          result.success && result.status === 'late' ? ' Marked late.' : '';
        setMessage(base + suffix);
        setSuccess(result.success);
      })
      .catch(() => {
        setMessage('Could not reach the server. Please try again.');
        setSuccess(false);
      });
  };

  const identityLabel = identityLoading
    ? 'Checking account...'
    : profileName ?? user?.email ?? 'Not logged in';

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.identityBar}>
          <Text style={styles.identityLabel}>Scanning as:</Text>
          <Text style={styles.identityName} numberOfLines={1}>
            {identityLabel}
          </Text>
        </View>
        {message ? (
          <View style={styles.card}>
            <Text
              style={[styles.message, success ? styles.ok : styles.fail]}
            >
              {message}
            </Text>
            {lastData ? (
              <Text style={styles.raw} numberOfLines={3}>
                {lastData}
              </Text>
            ) : null}
            <AppButton
              theme="primary"
              title="Scan Again"
              icon="refresh-outline"
              onPress={() => {
                setScanned(false);
                setMessage(null);
                setLastData(null);
              }}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.hint}>
              Point the camera at an event QR code
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 24,
    justifyContent: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 10,
  },
  identityBar: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  identityLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  identityName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    padding: 16,
    gap: 10,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  hint: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  ok: {
    color: COLORS.success,
  },
  fail: {
    color: COLORS.danger,
  },
  raw: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
});
