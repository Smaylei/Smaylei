import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores } from './tema';

/** Foto opcional (logo da loja, foto do produto): câmera ou galeria, recorte quadrado. */
export default function EscolherFoto({ uri, onEscolher, rotulo, tamanho = 96, icone = '📷' }: { uri: string | null; onEscolher: (uri: string) => void; rotulo: string; tamanho?: number; icone?: string }) {
  async function abrir(galeria: boolean) {
    const perm = galeria ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', galeria ? 'Permita o acesso às fotos.' : 'Permita o uso da câmera.');
      return;
    }
    const opcoes: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] };
    const r = galeria ? await ImagePicker.launchImageLibraryAsync(opcoes) : await ImagePicker.launchCameraAsync(opcoes);
    if (!r.canceled && r.assets[0]) onEscolher(r.assets[0].uri);
  }
  function escolher() {
    if (Platform.OS === 'web') return abrir(true);
    Alert.alert(rotulo, undefined, [
      { text: 'Tirar foto', onPress: () => abrir(false) },
      { text: 'Escolher da galeria', onPress: () => abrir(true) },
      { text: 'Voltar', style: 'cancel' },
    ]);
  }
  return (
    <Pressable style={s.linha} onPress={escolher}>
      <View style={[s.previa, { width: tamanho, height: tamanho, borderRadius: tamanho / 5 }]}>
        {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} /> : <Text style={{ fontSize: tamanho / 3 }}>{icone}</Text>}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rotulo}>{rotulo}</Text>
        <Text style={s.link}>{uri ? 'Trocar foto' : 'Adicionar foto'}</Text>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  previa: { backgroundColor: cores.cartaoAlto, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: cores.borda },
  rotulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14 },
});
