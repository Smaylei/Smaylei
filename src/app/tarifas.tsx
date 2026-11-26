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
      Admin.resumo()
        .then((r) => setCfg(r.config))
        .catch((e) => Alert.alert('Erro', (e as Error).message));
    }, []),
  );

  if (!cfg) return <ActivityIndicator style={{ marginTop: 60 }} color={cores.primaria} />;
  return (
    <TelaTarifas
      key={JSON.stringify([cfg.tarifas, cfg.margem, cfg.urgencia, cfg.incentivoUrgencia])}
      tarifas={cfg.tarifas}
      margem={cfg.margem}
      urgencia={cfg.urgencia}
      incentivo={cfg.incentivoUrgencia ?? 4}
      comissaoPct={cfg.comissaoMotoristaPct}
      onSalvar={(tarifas, margem, urgencia, incentivoUrgencia) =>
        Admin.salvarConfig({ tarifas, margem, urgencia, incentivoUrgencia })
          .then(setCfg)
          .catch((e) => Alert.alert('Não salvou', (e as Error).message))
      }
    />
  );
}
