import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { LOCAIS_INICIAIS, type Local } from '../data/locais';
import { precoServico, type ServicoId } from '../data/servicos';
import { TARIFAS_PADRAO } from '../data/tarifas';
import { API, lerToken } from '../services/api';
import { carregarEndereco, salvarEndereco, type Endereco } from '../services/cadastro';
import { rotaEntre, rotasAteCasa, type Ponto, type RotaMercado } from '../services/grafo';
import { URGENCIA_PADRAO, type Tarifa, type Urgencia } from '../services/preco';

type Config = { tarifas: Tarifa[]; margem: number; urgencia: Urgencia; esperaBorrachariaMin: number };

type Ctx = {
  carregado: boolean;
  casa: Endereco | null;
  /** Tem cadastro no servidor (token salvo)? */
  temConta: boolean;
  salvarCasa: (e: Endereco) => Promise<void>;
  config: Config;
  /** Mercados, padarias, farmácias, gás e bebidas, mecânicos e borracharias (definidos no Admin). */
  locais: Local[];
  /** Rotas já calculadas de cada local até a casa (null = sem rota; ausente = calculando). */
  rotas: Record<string, RotaMercado | null> | null;
  /** Valor do frete mercado → casa (compatível com a tela antiga). */
  valorFrete: (localId: string, agendado: boolean) => number | null;
  /** Valor de qualquer serviço entre dois pontos, calculado no aparelho (o servidor confere). */
  cotar: (servico: ServicoId, coleta: Ponto, entrega: Ponto, agendado: boolean) => number | null;
  /** Busca de novo as tarifas e os locais definidos no App Admin. */
  recarregarConfig: () => void;
};

const AppCtx = createContext<Ctx | null>(null);
const perto = (a: Ponto, b: Ponto) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

export function AppProvider({ children }: { children: ReactNode }) {
  const [carregado, setCarregado] = useState(false);
  const [casa, setCasa] = useState<Endereco | null>(null);
  const [temConta, setTemConta] = useState(false);
  const [config, setConfig] = useState<Config>({ tarifas: TARIFAS_PADRAO, margem: 0, urgencia: URGENCIA_PADRAO, esperaBorrachariaMin: 20 });
  const [locais, setLocais] = useState<Local[]>(LOCAIS_INICIAIS);
  const [rotas, setRotas] = useState<Ctx['rotas']>(null);

  // Tarifas, margem, urgência e locais vêm do servidor: qualquer mudança no App Admin vale aqui também.
  const recarregarConfig = useCallback(() => {
    if (!API) return;
    fetch(`${API}/v2/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: (Partial<Config> & { locais?: Local[] }) | null) => {
        if (c?.tarifas?.length)
          setConfig({ tarifas: c.tarifas, margem: c.margem ?? 0, urgencia: c.urgencia ?? URGENCIA_PADRAO, esperaBorrachariaMin: c.esperaBorrachariaMin ?? 20 });
        if (c?.locais) setLocais((antes) => (JSON.stringify(antes) === JSON.stringify(c.locais) ? antes : c.locais!));
      })
      .catch(() => {});
  }, []);

  // Rotas de todos os locais até a casa: calculadas no aparelho, em segundo plano.
  const chaveLocais = locais.map((l) => `${l.id}:${l.lat}:${l.lon}`).join('|');
  useEffect(() => {
    if (!casa) return;
    const t = setTimeout(() => setRotas(rotasAteCasa({ lat: casa.lat, lon: casa.lon }, locais)), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casa?.lat, casa?.lon, chaveLocais]);

  useEffect(() => {
    Promise.all([carregarEndereco(), lerToken('cliente')]).then(([e, t]) => {
      setCasa(e);
      setTemConta(!!t);
      setCarregado(true);
    });
    const t0 = setTimeout(recarregarConfig, 0);
    const t = setInterval(recarregarConfig, 60_000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [recarregarConfig]);

  const salvarCasa = useCallback(async (e: Endereco) => {
    setCasa(e);
    setTemConta(true);
    setRotas(null);
    await salvarEndereco(e).catch(() => {});
  }, []);

  const cotar = useCallback(
    (servico: ServicoId, coleta: Ponto, entrega: Ponto, agendado: boolean) => {
      // Local ↔ casa já calculado (ida e volta é simétrico); senão calcula agora.
      const local = casa && (perto(coleta, casa) ? entrega : perto(entrega, casa) ? coleta : null);
      const pronto = local ? locais.find((l) => perto(l, local)) : undefined;
      const r = pronto && rotas ? rotas[pronto.id] : rotaEntre(coleta, entrega);
      return r ? precoServico(r, config, servico, agendado) : null;
    },
    [casa, locais, rotas, config],
  );

  const valorFrete = useCallback(
    (localId: string, agendado: boolean) => {
      const r = rotas?.[localId];
      return r ? precoServico(r, config, 'comigo', agendado) : null;
    },
    [rotas, config],
  );

  return (
    <AppCtx.Provider value={{ carregado, casa, temConta, salvarCasa, config, locais, rotas, valorFrete, cotar, recarregarConfig }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}
