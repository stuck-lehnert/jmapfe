import { Text, TextInput, View } from "react-native"
import { styles } from "../../styles"
import { Theme } from "../../theme"
import { Ui } from "../primitives"

const { Button } = Ui
const C = Theme.colors

export function VaultUnlock({ masterPassword, error, onChange, onUnlock }: {
  readonly masterPassword: string
  readonly error: string | undefined
  readonly onChange: (value: string) => void
  readonly onUnlock: () => void
}) {
  return (
    <View style={styles.vaultUnlock}>
      <Text style={styles.vaultUnlockText}>Enter master password to unlock saved credentials.</Text>
      <TextInput value={masterPassword} placeholder="Master password" placeholderTextColor={C.placeholder} secureTextEntry onChangeText={onChange} autoCapitalize="none" style={styles.vaultUnlockInput} />
      <Button kind="filled" label="Unlock" disabled={masterPassword.length === 0} onPress={onUnlock} />
      {error === undefined ? null : <Text style={styles.vaultUnlockError}>{error}</Text>}
    </View>
  )
}
