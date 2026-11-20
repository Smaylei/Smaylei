import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { MERCADOS } from '../data/mercados';
import { TARIFAS_PADRAO } from '../data/tarifas';
import { API, lerToken } from '../services/api';
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
  /** Tem cadastro no servidor (token salvo)? */
  temConta: boolean;
  salvarCasa: (e: Endereco) => Promise<void>;
  config: Config;
  /** Rotas já calculadas por mercado (null = sem rota; ausente = calculando). */
  rotas: Record<string, RotaMercado | null> | null;
  /** Valor final do frete, calculado em segundo plano a partir da rota e das tarifas. */
  valorFrete: (mercadoId: string, agendado: boolean) => number | null;
  /** Busca de novo as tarifas definidas no App Admin. */
  recarregarConfig: () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [carregado, setCarregado] = useState(false);
  const [casa, setCasa] = useState<Endereco | null>(null);
  const [temConta, setTemConta] = useState(false);
  const [config, setConfig] = useState<Config>({ tarifas: TARIFAS_PADRAO, margem: 0, urgencia: URGENCIA_PADRAO });
  const [rotas, setRotas] = useState<Ctx['rotas']>(null);

  const calcular = useCallback((c: Endereco) => {
    setRotas(null);
    // Deixa a tela desenhar primeiro; a rota é calculada logo em seguida, no aparelho.
    setTimeout(() => setRotas(rotasAteCasa({ lat: c.lat, lon: c.lon }, MERCADOS)), 50);
  }, []);

  // Tarifas, margem e urgência vêm do servidor: qualquer mudança no App Admin vale aqui também.
  const recarregarConfig = useCallback(() => {
    if (!API) return;
    fetch(`${API}/v2/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Partial<Config> | null) => {
        if (c?.tarifas?.length) setConfig({ tarifas: c.tarifas, margem: c.margem ?? 0, urgencia: c.urgencia ?? URGENCIA_PADRAO });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([carregarEndereco(), lerToken('cliente')]).then(([e, t]) => {
      setCasa(e);
      setTemConta(!!t);
      setCarregado(true);
      if (e) calcular(e);
    });
    const t0 = setTimeout(recarregarConfig, 0);
    const t = setInterval(recarregarConfig, 60_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [calcular, recarregarConfig]);

  const salvarCasa = useCallback(
    async (e: Endereco) => {
      setCasa(e);
      setTemConta(true);
      calcular(e);
      await salvarEndereco(e).catch(() => {});
    },
    [calcular],
  );

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
    <AppCtx.Provider value={{ carregado, casa, temConta, salvarCasa, config, rotas, valorFrete, recarregarConfig }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}
