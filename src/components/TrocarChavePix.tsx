import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ErroApi } from '../services/api';
import { chavePixValida, TIPOS_CHAVE_PIX, type TipoChavePix } from '../services/pix';
import { cores, raio } from './tema';

const DICA: Record<TipoChavePix, { placeholder: string; teclado: 'default' | 'number-pad' | 'email-address' | 'phone-pad' }> = {
  cpf: { placeholder: '000.000.000-00', teclado: 'number-pad' },
  cnpj: { placeholder: '00.000.000/0000-00', teclado: 'number-pad' },
  celular: { placeholder: '(47) 99999-9999', teclado: 'phone-pad' },
  email: { placeholder: 'voce@email.com', teclado: 'email-address' },
  aleatoria: { placeholder: '123e4567-e89b-12d3-a456-426614174000', teclado: 'default' },
};

type Props = {
  visivel: boolean;
  papel: 'motorista' | 'lojista';
  aoFechar: () => void;
  aoSalvar: (r: { pix: string; pixTipo: TipoChavePix }) => void;
};

/** Trocar a chave Pix onde o motorista (saques) ou a loja (repasses) recebe: qualquer tipo de chave, com a senha da conta. */
export default function TrocarChavePix({ visivel, papel, aoFechar, aoSalvar }: Props) {
  const [tipo, setTipo] = useState<TipoChavePix>('celular');
  const [chave, setChave] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function fechar() {
    setChave('');
    setSenha('');
    setErro(null);
    aoFechar();
  }
  async function salvar() {
    if (!chavePixValida(tipo, chave)) {
      setErro(`Confira a chave: ${TIPOS_CHAVE_PIX.find((t) => t.id === tipo)?.nome} inválido.`);
      return;
    }
    if (senha.length < 6) {
      setErro('Digite a senha da sua conta MOVI.');
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const r = await api<{ pix: string; pixTipo: TipoChavePix }>(papel, '/v2/eu/pix', { method: 'PUT', corpo: { tipo, chave, senha } });
      setChave('');
      setSenha('');
      aoSalvar(r);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={fechar}>
      <KeyboardAvoidingView style={s.fundo} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.caixa}>
          <Text style={s.titulo}>Trocar chave Pix</Text>
          <Text style={s.sub}>{papel === 'motorista' ? 'Os próximos saques vão para esta chave.' : 'Os próximos repasses das vendas vão para esta chave.'} Ela precisa estar no seu nome.</Text>
          <View style={s.chips}>
            {TIPOS_CHAVE_PIX.map((t) => (
              <Pressable
                key={t.id}
                style={[s.chip, tipo === t.id && s.chipAtivo]}
                onPress={() => {
                  setTipo(t.id);
                  setErro(null);
                }}
              >
                <Text style={[s.chipTexto, tipo === t.id && { color: cores.primaria }]}>{t.nome}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={s.input}
            value={chave}
            onChangeText={setChave}
            placeholder={DICA[tipo].placeholder}
            placeholderTextColor={cores.apagado}
            keyboardType={DICA[tipo].teclado}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={77}
          />
          <Text style={s.rotulo}>Senha da sua conta MOVI</Text>
          <TextInput style={s.input} value={senha} onChangeText={setSenha} secureTextEntry placeholder="••••••" placeholderTextColor={cores.apagado} maxLength={64} />
          {erro && <Text style={s.erro}>{erro}</Text>}
          <Pressable style={[s.botao, ocupado && { opacity: 0.5 }]} disabled={ocupado} onPress={salvar}>
            {ocupado ? <ActivityIndicator color="#fff" /> : <Text style={s.botaoTexto}>Salvar chave</Text>}
          </Pressable>
          <Pressable onPress={fechar} hitSlop={8}>
            <Text style={s.cancelar}>Cancelar</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  caixa: { backgroundColor: cores.cartao, borderRadius: raio + 4, padding: 20, gap: 10, maxWidth: 460, width: '100%', alignSelf: 'center' },
  titulo: { fontSize: 19, fontWeight: '700', color: cores.texto },
  sub: { fontSize: 13, color: cores.suave, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: cores.borda },
  chipAtivo: { borderColor: cores.primaria, backgroundColor: cores.primariaClara },
  chipTexto: { color: cores.texto, fontSize: 13, fontWeight: '600' },
  rotulo: { fontSize: 13, color: cores.suave },
  input: { backgroundColor: cores.fundo, borderRadius: 12, borderWidth: 1, borderColor: cores.borda, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: cores.texto },
  erro: { color: cores.erro, fontSize: 13 },
  botao: { backgroundColor: cores.primaria, borderRadius: raio, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  botaoTexto: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelar: { color: cores.suave, fontWeight: '700', textAlign: 'center', padding: 6 },
});
