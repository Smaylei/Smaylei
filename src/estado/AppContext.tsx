import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { MERCADOS } from '../data/mercados';
import { TARIFAS_PADRAO } from '../data/tarifas';
import {
  carregarMargem,
  carregarTarifas,
  carregarUrgencia,
  salvarMargem,
  salvarTarifas,
  salvarUrgencia,
} from '../services/armazenamento';
import { carregarEndereco, salvarEndereco, type Endereco } from '../services/cadastro';
import { rotasAteCasa, type RotaMercado } from '../services/grafo';
import {
  estimarIdaEVolta,
  precoFrete,
  precoSugerido,
  URGENCIA_PADRAO,
  type Tarifa,
  type Urgencia,
} from '../services/preco';

type Config = { tarifas: Tarifa[]; margem: number; urgencia: Urgencia };

type Ctx = {
  carregado: boolean;
  casa: Endereco | null;
  salvarCasa: (e: Endereco) => Promise<void>;
  config: Config;
  salvarConfig: (c: Config) => Promise<void>;
  /** Rotas já calculadas por mercado (null = sem rota; ausente = calculando). */
  rotas: Record<string, RotaMercado | null> | null;
  /** Valor final do frete, calculado em segundo plano a partir da rota e das tarifas. */
  valorFrete: (mercadoId: string, agendado: boolean) => number | null;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [carregado, setCarregado] = useState(false);
  const [casa, setCasa] = useState<Endereco | null>(null);
  const [config, setConfig] = useState<Config>({ tarifas: TARIFAS_PADRAO, margem: 0, urgencia: URGENCIA_PADRAO });
  const [rotas, setRotas] = useState<Ctx['rotas']>(null);

  const calcular = useCallback((c: Endereco) => {
    setRotas(null);
    // Deixa a tela desenhar primeiro; a rota é calculada logo em seguida, no aparelho.
    setTimeout(() => setRotas(rotasAteCasa({ lat: c.lat, lon: c.lon }, MERCADOS)), 50);
  }, []);

  useEffect(() => {
    Promise.all([carregarEndereco(), carregarTarifas(), carregarMargem(), carregarUrgencia()]).then(
      ([e, tarifas, margem, urgencia]) => {
        setConfig({ tarifas, margem, urgencia });
        setCasa(e);
        setCarregado(true);
        if (e) calcular(e);
      },
    );
  }, [calcular]);

  const salvarCasa = useCallback(
    async (e: Endereco) => {
      setCasa(e);
      calcular(e);
      await salvarEndereco(e).catch(() => {});
    },
    [calcular],
  );

  const salvarConfig = useCallback(async (c: Config) => {
    setConfig(c);
    await Promise.all([salvarTarifas(c.tarifas), salvarMargem(c.margem), salvarUrgencia(c.urgencia)]).catch(() => {});
  }, []);

  const valorFrete = useCallback(
    (mercadoId: string, agendado: boolean) => {
      const r = rotas?.[mercadoId];
      if (!r) return null;
      const sugerido = precoSugerido(config.tarifas.map((t) => estimarIdaEVolta(r, t)), config.margem);
      return precoFrete(sugerido, agendado, config.urgencia);
    },
    [rotas, config],
  );

  return (
    <AppCtx.Provider value={{ carregado, casa, salvarCasa, config, salvarConfig, rotas, valorFrete }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}
