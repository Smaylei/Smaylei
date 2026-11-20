import TelaTarifas from '../components/TelaTarifas';
import { useApp } from '../estado/AppContext';

/** Tela escondida (toque longo no "Olá" da tela inicial) para ajustar tarifas e urgência. */
export default function Admin() {
  const { config, salvarConfig } = useApp();
  return (
    <TelaTarifas
      key={JSON.stringify(config)}
      tarifas={config.tarifas}
      margem={config.margem}
      urgencia={config.urgencia}
      onSalvar={(tarifas, margem, urgencia) => salvarConfig({ tarifas, margem, urgencia })}
    />
  );
}
