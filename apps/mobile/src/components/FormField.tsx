import { Eye, EyeOff, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";

import { usePreferences } from "../contexts/PreferencesContext";

type FormFieldProps = TextInputProps & {
  label: string;
  icon: LucideIcon;
  password?: boolean;
  hint?: string;
};

export function FormField({ label, icon: Icon, password, hint, ...props }: FormFieldProps) {
  const { palette } = usePreferences();
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: palette.text }]}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: palette.line, backgroundColor: palette.surface }]}>
        <Icon size={18} color={palette.faint} />
        <TextInput
          {...props}
          style={[styles.input, { color: palette.text }]}
          placeholderTextColor={palette.faint}
          secureTextEntry={password && !visible}
          autoCapitalize="none"
        />
        {password ? (
          <Pressable onPress={() => setVisible((value) => !value)} hitSlop={10}>
            {visible ? <EyeOff size={17} color={palette.faint} /> : <Eye size={17} color={palette.faint} />}
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={[styles.hint, { color: palette.faint }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { fontSize: 12, fontWeight: "700" },
  inputWrap: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 13,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 15 },
  hint: { fontSize: 10 },
});
