import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CidadeId } from '../data/cidades';
import { LOCAIS_INICIAIS, type Local } from '../data/locais';
import { LIBERACAO_PADRAO, MOTO_PADRAO, type ConfigMoto, type Liberacao } from '../data/servicos';
import { TARIFAS_PADRAO } from '../data/tarifas';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API, api, apagarToken, ErroApi, lerToken } from '../services/api';
import { carregarEndereco, salvarEndereco, type Endereco } from '../services/cadastro';
import { URGENCIA_PADRAO, type Tarifa, type Urgencia } from '../services/preco';
import { MODO, SOLICITANTE } from '../variante';

type Config = Liberacao & ConfigMoto & { tarifas: Tarifa[]; margem: number; urgencia: Urgencia; esperaBorrachariaMin: number; comissaoMotoristaPct: number };

/** Cadastro no servidor de quem pede (cliente ou loja). */
export type Eu = { tipo: 'cliente' | 'lojista'; nome: string; temSenha?: boolean; status?: 'pendente' | 'aprovado' | 'bloqueado'; lojaNome?: string; cidade?: CidadeId | null };

type Ctx = {
  carregado: boolean;
  /** Casa do cliente ou endereço da loja (perfil Lojista). */
  casa: Endereco | null;
  /** Tem cadastro no servidor (token salvo)? */
  temConta: boolean;
  eu: Eu | null;
  salvarCasa: (e: Endereco) => Promise<void>;
  recarregarEu: () => void;
  config: Config;
  /** Mercados e demais locais liberados (definidos no Admin). */
  locais: Local[];
  /** Busca de novo as tarifas, os serviços liberados e os locais definidos no Admin. */
  recarregarConfig: () => void;
};

const AppCtx = createContext<Ctx | null>(null);
const pedeCorridas = MODO === 'cliente' || MODO === 'lojista';

export function AppProvider({ children }: { children: ReactNode }) {
  const [carregado, setCarregado] = useState(false);
  const [casa, setCasa] = useState<Endereco | null>(null);
  const [temConta, setTemConta] = useState(false);
  const [eu, setEu] = useState<Eu | null>(null);
  const [config, setConfig] = useState<Config>({
    tarifas: TARIFAS_PADRAO,
    margem: 0,
    urgencia: URGENCIA_PADRAO,
    esperaBorrachariaMin: 20,
    comissaoMotoristaPct: 80,
    ...LIBERACAO_PADRAO,
    ...MOTO_PADRAO,
  });
  const [locais, setLocais] = useState<Local[]>(LOCAIS_INICIAIS.filter((l) => l.categoria === 'mercado'));

  // Tarifas, serviços, cidades e locais vêm do servidor: qualquer mudança no Admin vale aqui também.
  const recarregarConfig = useCallback(() => {
    if (!API) return;
    fetch(`${API}/v2/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: (Partial<Config> & { locais?: Local[] }) | null) => {
        if (c?.tarifas?.length)
          setConfig({
            tarifas: c.tarifas,
            margem: c.margem ?? 0,
            urgencia: c.urgencia ?? URGENCIA_PADRAO,
            esperaBorrachariaMin: c.esperaBorrachariaMin ?? 20,
            comissaoMotoristaPct: c.comissaoMotoristaPct ?? 80,
            servicosAtivos: c.servicosAtivos ?? LIBERACAO_PADRAO.servicosAtivos,
            categoriasAtivas: c.categoriasAtivas ?? LIBERACAO_PADRAO.categoriasAtivas,
            outroEnderecoLoja: c.outroEnderecoLoja ?? LIBERACAO_PADRAO.outroEnderecoLoja,
            cidadesAtivas: c.cidadesAtivas ?? LIBERACAO_PADRAO.cidadesAtivas,
            motoAtivo: c.motoAtivo ?? MOTO_PADRAO.motoAtivo,
            motoServicos: c.motoServicos ?? MOTO_PADRAO.motoServicos,
            motoMinimo: c.motoMinimo ?? MOTO_PADRAO.motoMinimo,
            motoKmIncluso: c.motoKmIncluso ?? MOTO_PADRAO.motoKmIncluso,
            motoPorKm: c.motoPorKm ?? MOTO_PADRAO.motoPorKm,
            motoRepassePct: c.motoRepassePct ?? MOTO_PADRAO.motoRepassePct,
          });
        if (c?.locais) setLocais((antes) => (JSON.stringify(antes) === JSON.stringify(c.locais) ? antes : c.locais!));
      })
      .catch(() => {});
  }, []);

  // O cadastro no servidor é a referência (status da loja, endereço atualizado).
  const recarregarEu = useCallback(() => {
    if (!pedeCorridas) return;
    api<Eu & { endereco: string; lat: number; lon: number; telefone?: string }>(SOLICITANTE, '/v2/eu')
      .then((d) => {
        setEu(d);
        setCasa((c) => (c && c.lat === d.lat && c.lon === d.lon && c.endereco === d.endereco ? c : { ...(c ?? {}), nome: d.nome, endereco: d.endereco, lat: d.lat, lon: d.lon }));
      })
      .catch(async (e) => {
        // Conta excluída no Admin (ou acesso inválido): volta para Entrar / Realizar cadastro.
        if (e instanceof ErroApi && e.status === 401) {
          await apagarToken(SOLICITANTE).catch(() => {});
          await AsyncStorage.removeItem(SOLICITANTE === 'lojista' ? 'cadastro:loja:v1' : 'cadastro:casa:v1').catch(() => {});
          setEu(null);
          setCasa(null);
          setTemConta(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!pedeCorridas) {
      const t = setTimeout(() => setCarregado(true), 0);
      return () => clearTimeout(t);
    }
    Promise.all([carregarEndereco(SOLICITANTE), lerToken(SOLICITANTE)]).then(([e, t]) => {
      setCasa(e);
      setTemConta(!!t);
      setCarregado(true);
      if (t) recarregarEu();
    });
  }, [recarregarEu]);

  useEffect(() => {
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
    await salvarEndereco(e, SOLICITANTE).catch(() => {});
  }, []);

  return <AppCtx.Provider value={{ carregado, casa, temConta, eu, salvarCasa, recarregarEu, config, locais, recarregarConfig }}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp fora do AppProvider');
  return c;
}
