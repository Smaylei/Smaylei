import * as ImagePicker from 'expo-image-picker';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { cores, raio } from './tema';

type Props = {
  rotulo: string;
  uri: string | null;
  onFoto: (uri: string) => void;
  frontal?: boolean; // selfie
  enviada?: boolean; // já existe no servidor
  formato?: 'rosto' | 'documento';
};

/** Tira uma foto com a câmera (ou escolhe da galeria) e mostra a prévia. */
export default function CampoFoto({ rotulo, uri, onFoto, frontal, enviada, formato = 'rosto' }: Props) {
  async function tirar(galeria: boolean) {
    const perm = galeria ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', galeria ? 'Permita o acesso às fotos.' : 'Permita o uso da câmera.');
      return;
    }
    const opcoes: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: formato === 'rosto' ? [1, 1] : [4, 3],
      cameraType: frontal ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
    };
    const r = galeria ? await ImagePicker.launchImageLibraryAsync(opcoes) : await ImagePicker.launchCameraAsync(opcoes);
    if (!r.canceled && r.assets[0]) onFoto(r.assets[0].uri);
  }

  return (
    <View style={s.caixa}>
      <View style={[s.previa, formato === 'documento' && s.previaDoc]}>
        {uri ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} />
        ) : (
          <Text style={s.icone}>{enviada ? '✓' : formato === 'rosto' ? '🙂' : '🪪'}</Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.rotulo}>{rotulo}</Text>
        <Text style={s.status}>{uri ? 'Foto pronta para enviar' : enviada ? 'Enviada' : 'Obrigatória'}</Text>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Pressable onPress={() => tirar(false)} hitSlop={6}>
            <Text style={s.link}>📷 Tirar foto</Text>
          </Pressable>
          {!frontal && (
            <Pressable onPress={() => tirar(true)} hitSlop={6}>
              <Text style={s.link}>Galeria</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: cores.cartao, borderWidth: 1, borderColor: cores.borda, borderRadius: raio, padding: 12 },
  previa: { width: 72, height: 72, borderRadius: 36, backgroundColor: cores.fundo, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  previaDoc: { width: 96, height: 72, borderRadius: 10 },
  icone: { fontSize: 30, color: cores.primaria },
  rotulo: { fontSize: 15, fontWeight: '700', color: cores.texto },
  status: { fontSize: 12, color: cores.suave },
  link: { color: cores.primaria, fontWeight: '700', fontSize: 14 },
});
