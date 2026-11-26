import { StyleSheet, Text, TextInput, View } from 'react-native';
import { cores, raio, sombra } from './tema';

/** Senha + confirmação do cadastro (para entrar depois com CPF e senha em qualquer celular). */
export default function CamposSenha({ senha, confirma, onSenha, onConfirma }: { senha: string; confirma: string; onSenha: (s: string) => void; onConfirma: (s: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.rotulo}>Crie uma senha (mínimo 6 caracteres)</Text>
      <TextInput style={s.input} value={senha} onChangeText={onSenha} placeholder="Senha" placeholderTextColor={cores.apagado} secureTextEntry autoComplete="new-password" />
      <TextInput style={s.input} value={confirma} onChangeText={onConfirma} placeholder="Repita a senha" placeholderTextColor={cores.apagado} secureTextEntry autoComplete="new-password" />
      {confirma.length > 0 && senha !== confirma && <Text style={s.erro}>As senhas não são iguais.</Text>}
      <Text style={s.dica}>Com o CPF e esta senha você entra em qualquer celular, sem refazer o cadastro.</Text>
    </View>
  );
}

export const senhaOk = (senha: string, confirma: string) => senha.length >= 6 && senha === confirma;

const s = StyleSheet.create({
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 8 },
  input: { backgroundColor: cores.cartao, ...sombra, borderRadius: raio, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: cores.texto },
  erro: { color: cores.erro, fontSize: 13 },
  dica: { fontSize: 12, color: cores.suave },
});
