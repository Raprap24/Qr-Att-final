import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/colors';

type AppButtonProps = {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  theme?: 'primary';
  onPress: () => void;
  disabled?: boolean;
};

export default function AppButton({
  title,
  icon,
  theme,
  onPress,
  disabled,
}: AppButtonProps) {
  const isPrimary = theme === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.buttonInner,
        isPrimary ? styles.primaryFill : styles.secondaryFill,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.row}>
        <Ionicons
          name={icon}
          size={20}
          color={isPrimary ? COLORS.textOnPrimary : COLORS.textPrimary}
        />
        <Text style={[styles.label, isPrimary && styles.labelPrimary]}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonInner: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryFill: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: '#A78BFA',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 8,
  },
  secondaryFill: {
    backgroundColor: '#151022CC',
    borderWidth: 1,
    borderColor: COLORS.cardBorderNeon,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  labelPrimary: {
    fontWeight: '700',
    color: COLORS.textOnPrimary,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
});
