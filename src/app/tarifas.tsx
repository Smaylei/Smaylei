import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert } from 'react-native';
import TelaTarifas from '../components/TelaTarifas';
import { cores } from '../components/tema';
import * as Admin from '../services/admin';

/** Tarifas, margem e urgência guardadas no servidor: valem para todos os clientes. */
export default function Tarifas() {
  const [cfg, setCfg] = useState<Admin.ConfigServidor | null>(null);

  useFocusEffect(
    useCallback(() => {
      Admin.status()
        .then((s) => setCfg(s.config))
        .catch((e) => Alert.alert('Erro', (e as Error).message));
    }, []),
  );

  if (!cfg) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  return (
    <TelaTarifas
      key={JSON.stringify([cfg.tarifas, cfg.margem, cfg.urgencia])}
      tarifas={cfg.tarifas}
      margem={cfg.margem}
      urgencia={cfg.urgencia}
      onSalvar={(tarifas, margem, urgencia) =>
        Admin.salvarConfig({ tarifas, margem, urgencia })
          .then(setCfg)
          .catch((e) => Alert.alert('Não salvou', (e as Error).message))
      }
    />
  );
}
