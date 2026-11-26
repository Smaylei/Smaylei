import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BotaoInicio, Marca } from '../components/Marca';
import { cores, raio } from '../components/tema';
import { useApp } from '../estado/AppContext';
import { api, ErroApi, guardarToken } from '../services/api';
import { MODO } from '../variante';

type Resposta = { token: string; nome: string; telefone?: string; endereco: string | null; lat: number | null; lon: number | null; lojaNome?: string | null };

const CADASTRO = { cliente: '/cadastro', motorista: '/cadastro-motorista', lojista: '/cadastro-lojista' } as const;
const INICIO = { cliente: '/cliente', motorista: '/motorista', lojista: '/lojista' } as const;

/** Depois de escolher o perfil: entrar com CPF (ou CNPJ, lojista) e senha, ou fazer um cadastro novo. */
export default function Entrar() {
  const perfil = MODO === 'motorista' || MODO === 'lojista' ? MODO : 'cliente';
  const { salvarCasa, recarregarEu } = useApp();
  const [documento, setDocumento] = useState('');
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ajuda, setAjuda] = useState(false);

  const digitos = documento.replace(/\D/g, '');
  const pronto = (digitos.length === 11 || (perfil === 'lojista' && digitos.length === 14)) && senha.length >= 6;

  async function entrar() {
    if (!pronto) return;
    setOcupado(true);
    setMsg(null);
    try {
      const r = await api<Resposta>(null, '/v2/entrar', { method: 'POST', corpo: { perfil, documento: digitos, senha } });
      await guardarToken(perfil, r.token);
      if (perfil !== 'motorista' && r.endereco && r.lat != null && r.lon != null) {
        await salvarCasa({ nome: r.lojaNome ?? r.nome, endereco: r.endereco, telefone: r.telefone, lat: r.lat, lon: r.lon });
        recarregarEu();
      }
      router.replace(INICIO[perfil]);
    } catch (e) {
      setMsg(e instanceof ErroApi ? e.message : 'Sem conexão. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: '', headerLeft: () => <BotaoInicio /> }} />
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Marca perfil={perfil} largura={220} />
        </View>

        <View style={s.cartao}>
          <Text style={s.titulo}>Entrar</Text>
          <Text style={s.sub}>Já tem cadastro? Use seus dados de acesso.</Text>
          <Text style={s.rotulo}>{perfil === 'lojista' ? 'CPF do responsável ou CNPJ' : 'CPF'}</Text>
          <TextInput
            style={s.input}
            value={documento}
            onChangeText={setDocumento}
            placeholder={perfil === 'lojista' ? 'Só os números' : '000.000.000-00'}
            placeholderTextColor={cores.apagado}
            keyboardType="number-pad"
            autoComplete="username"
            maxLength={18}
          />
          <Text style={s.rotulo}>Senha</Text>
          <View>
            <TextInput
              style={s.input}
              value={senha}
              onChangeText={setSenha}
              placeholder="Sua senha"
              placeholderTextColor={cores.apagado}
              secureTextEntry={!ver}
              autoComplete="password"
              onSubmitEditing={entrar}
              returnKeyType="go"
            />
            <Pressable style={s.ver} onPress={() => setVer(!ver)} hitSlop={8}>
              <Text style={s.verTexto}>{ver ? 'Ocultar' : 'Mostrar'}</Text>
            </Pressable>
          </View>
          {msg && <Text style={s.erro}>{msg}</Text>}
          <Pressable style={[s.botao, (!pronto || ocupado) && { opacity: 0.45 }]} disabled={!pronto || ocupado} onPress={entrar}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Entrar</Text>}
          </Pressable>
          <Pressable onPress={() => setAjuda(!ajuda)}>
            <Text style={s.link}>Esqueci minha senha</Text>
          </Pressable>
          {ajuda && (
            <Text style={s.ajuda}>
              Fale com o suporte da MOVI: eles geram uma senha provisória para você entrar e depois trocar em “Minha conta”. Se você se cadastrou antes de existir senha,
              abra o app no celular em que fez o cadastro e crie a senha em “Minha conta”.
            </Text>
          )}
        </View>

        <View style={s.novo}>
          <Text style={s.sub}>Primeira vez na MOVI?</Text>
          <Pressable style={s.botaoSec} onPress={() => router.push(CADASTRO[perfil])}>
            <Text style={s.botaoSecTexto}>Realizar cadastro</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  conteudo: { padding: 20, paddingTop: 24, gap: 18, flexGrow: 1 },
  cartao: { backgroundColor: cores.cartao, borderRadius: raio + 2, padding: 18, gap: 8, borderWidth: 1, borderColor: cores.borda },
  titulo: { fontSize: 22, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 14, color: cores.suave },
  rotulo: { fontSize: 13, color: cores.suave, marginTop: 6 },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, color: cores.texto },
  ver: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  verTexto: { color: cores.primaria, fontWeight: '700', fontSize: 13 },
  erro: { color: cores.erro, fontSize: 14, marginTop: 4 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  botaoTexto: { color: '#fff', fontSize: 17, fontWeight: '700' },
  link: { color: cores.primaria, fontWeight: '600', fontSize: 14, textAlign: 'center', paddingVertical: 8 },
  ajuda: { fontSize: 13, color: cores.suave, lineHeight: 19 },
  novo: { alignItems: 'center', gap: 10 },
  botaoSec: { alignSelf: 'stretch', borderRadius: raio, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5, borderColor: cores.primaria },
  botaoSecTexto: { color: cores.primaria, fontSize: 17, fontWeight: '700' },
});
