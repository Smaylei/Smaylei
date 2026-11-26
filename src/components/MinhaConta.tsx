import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, apagarToken, ErroApi } from '../services/api';
import { MODO, trocarModo } from '../variante';
import { cores, raio } from './tema';

/**
 * Rodapé "Minha conta" dos três perfis: criar a senha (contas antigas), trocar a senha e sair.
 * Com a senha, a pessoa entra com CPF/CNPJ em qualquer celular, sem refazer o cadastro.
 */
export default function MinhaConta({ temSenha, onSenhaCriada }: { temSenha: boolean; onSenhaCriada?: () => void }) {
  const papel = MODO === 'motorista' || MODO === 'lojista' ? MODO : 'cliente';
  const [aberto, setAberto] = useState(!temSenha);
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const ok = nova.length >= 6 && nova === confirma && (!temSenha || atual.length >= 6);

  async function salvar() {
    setOcupado(true);
    setMsg(null);
    try {
      await api(papel, '/v2/eu/senha', { method: 'POST', corpo: { atual: temSenha ? atual : undefined, nova } });
      setAtual('');
      setNova('');
      setConfirma('');
      setAberto(false);
      onSenhaCriada?.();
      Alert.alert('Senha salva', 'Agora você entra com seu CPF e essa senha em qualquer celular.');
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  function sair() {
    Alert.alert('Sair desta conta?', 'Para voltar, toque em Entrar e use seu CPF e senha.', [
      { text: 'Voltar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          await apagarToken(papel);
          await AsyncStorage.removeItem(papel === 'lojista' ? 'cadastro:loja:v1' : 'cadastro:casa:v1').catch(() => {});
          await trocarModo(MODO);
        },
      },
    ]);
  }

  return (
    <View style={s.caixa}>
      <Text style={s.titulo}>Minha conta</Text>
      {!temSenha && <Text style={s.aviso}>🔑 Crie uma senha para entrar com seu CPF em outro celular, sem fazer cadastro de novo.</Text>}
      {!aberto ? (
        <Pressable onPress={() => setAberto(true)}>
          <Text style={s.link}>{temSenha ? 'Alterar senha' : 'Criar senha'}</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          {temSenha && (
            <TextInput style={s.input} value={atual} onChangeText={setAtual} placeholder="Senha atual" placeholderTextColor={cores.apagado} secureTextEntry />
          )}
          <TextInput style={s.input} value={nova} onChangeText={setNova} placeholder="Nova senha (mínimo 6)" placeholderTextColor={cores.apagado} secureTextEntry />
          <TextInput style={s.input} value={confirma} onChangeText={setConfirma} placeholder="Repita a nova senha" placeholderTextColor={cores.apagado} secureTextEntry />
          {confirma.length > 0 && nova !== confirma && <Text style={s.erro}>As senhas não são iguais.</Text>}
          {msg && <Text style={s.erro}>{msg}</Text>}
          <Pressable style={[s.botao, (!ok || ocupado) && { opacity: 0.45 }]} disabled={!ok || ocupado} onPress={salvar}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar senha</Text>}
          </Pressable>
        </View>
      )}
      <Pressable onPress={sair}>
        <Text style={[s.link, { color: cores.erro }]}>Sair desta conta</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { backgroundColor: cores.cartao, borderRadius: raio, padding: 16, gap: 6, borderWidth: 1, borderColor: cores.borda },
  titulo: { fontSize: 13, fontWeight: '700', color: cores.suave, textTransform: 'uppercase', letterSpacing: 0.6 },
  aviso: { fontSize: 14, color: cores.alerta, lineHeight: 20 },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 15, paddingVertical: 6 },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: cores.texto },
  erro: { color: cores.erro, fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
