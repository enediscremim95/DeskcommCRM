import { readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const FALHAS_DE_POOL_ANTES_DO_REINICIO = 3;
export const MAX_REINICIOS_NA_JANELA = 3;
export const JANELA_DE_REINICIOS_MS = 60 * 60 * 1_000;

const CAMINHO_ESTADO = path.join(tmpdir(), "crm-auto-cura-banco.json");

export type DiagnosticoBanco = "ok" | "pool_saturado" | "banco_indisponivel";

type EstadoPersistido = {
  versao: 1;
  falhas_consecutivas_pool: number;
  reinicios_em_ms: number[];
};

export type StatusAutoCura =
  | "pronto"
  | "confirmando_pool_saturado"
  | "reinicio_agendado"
  | "limite_de_reinicios_atingido"
  | "banco_indisponivel_sem_reinicio"
  | "controle_indisponivel";

export type EstadoPublicoAutoCura = {
  status: StatusAutoCura;
  diagnostico_atual: DiagnosticoBanco;
  falhas_consecutivas_pool: number;
  falhas_necessarias: number;
  reinicios_na_janela: number;
  max_reinicios_na_janela: number;
  janela_segundos: number;
  encerra_processo: boolean;
  bloqueado_ate?: string;
};

export type ResultadoAutoCura = {
  estado: EstadoPublicoAutoCura;
  deve_encerrar: boolean;
};

export interface ArmazenamentoAutoCura {
  ler(): Promise<EstadoPersistido>;
  salvar(estado: EstadoPersistido): Promise<void>;
}

const ESTADO_INICIAL: EstadoPersistido = {
  versao: 1,
  falhas_consecutivas_pool: 0,
  reinicios_em_ms: [],
};

function copiarEstado(estado: EstadoPersistido): EstadoPersistido {
  return { ...estado, reinicios_em_ms: [...estado.reinicios_em_ms] };
}

function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro !== "object" || erro === null || !("code" in erro)) return undefined;
  const code = (erro as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function validarEstado(valor: unknown): EstadoPersistido {
  if (typeof valor !== "object" || valor === null) throw new Error("estado_nao_e_objeto");
  const candidato = valor as Partial<EstadoPersistido>;
  if (
    candidato.versao !== 1 ||
    !Number.isInteger(candidato.falhas_consecutivas_pool) ||
    (candidato.falhas_consecutivas_pool ?? -1) < 0 ||
    !Array.isArray(candidato.reinicios_em_ms) ||
    !candidato.reinicios_em_ms.every((item) => Number.isFinite(item) && item >= 0)
  ) {
    throw new Error("estado_invalido");
  }
  return {
    versao: 1,
    falhas_consecutivas_pool: candidato.falhas_consecutivas_pool!,
    reinicios_em_ms: [...candidato.reinicios_em_ms],
  };
}

export function criarArmazenamentoArquivo(
  caminho = CAMINHO_ESTADO,
): ArmazenamentoAutoCura {
  return {
    async ler() {
      try {
        return validarEstado(JSON.parse(await readFile(caminho, "utf8")));
      } catch (erro) {
        if (codigoDoErro(erro) === "ENOENT") return copiarEstado(ESTADO_INICIAL);
        throw erro;
      }
    },
    async salvar(estado) {
      const temporario = `${caminho}.${process.pid}.tmp`;
      await writeFile(temporario, JSON.stringify(estado), { encoding: "utf8", mode: 0o600 });
      await rename(temporario, caminho);
    },
  };
}

const armazenamentoPadrao = criarArmazenamentoArquivo();

function estadoPublico(
  status: StatusAutoCura,
  diagnostico: DiagnosticoBanco,
  estado: EstadoPersistido,
  deveEncerrar: boolean,
): EstadoPublicoAutoCura {
  const bloqueadoAte =
    status === "limite_de_reinicios_atingido" && estado.reinicios_em_ms[0] !== undefined
      ? new Date(estado.reinicios_em_ms[0] + JANELA_DE_REINICIOS_MS).toISOString()
      : undefined;

  return {
    status,
    diagnostico_atual: diagnostico,
    falhas_consecutivas_pool: estado.falhas_consecutivas_pool,
    falhas_necessarias: FALHAS_DE_POOL_ANTES_DO_REINICIO,
    reinicios_na_janela: estado.reinicios_em_ms.length,
    max_reinicios_na_janela: MAX_REINICIOS_NA_JANELA,
    janela_segundos: JANELA_DE_REINICIOS_MS / 1_000,
    encerra_processo: deveEncerrar,
    ...(bloqueadoAte ? { bloqueado_ate: bloqueadoAte } : {}),
  };
}

function podarReinicios(estado: EstadoPersistido, agoraMs: number): boolean {
  const anteriores = estado.reinicios_em_ms.length;
  estado.reinicios_em_ms = estado.reinicios_em_ms.filter(
    (instante) => agoraMs - instante < JANELA_DE_REINICIOS_MS,
  );
  return anteriores !== estado.reinicios_em_ms.length;
}

type OpcoesAvaliacao = {
  diagnostico: DiagnosticoBanco;
  sonda_autorizada: boolean;
  agora_ms?: number;
  armazenamento?: ArmazenamentoAutoCura;
  ao_agendar_reinicio?: () => void;
};

/**
 * Só PGRST003 vira `pool_saturado` e pode reiniciar o app. Falha de alcance do
 * banco mantém o processo vivo, pois reiniciá-lo não recupera a dependência e
 * criaria um laço. O arquivo em /tmp sobrevive ao restart do mesmo container,
 * então o teto continua valendo entre processos.
 */
export async function avaliarAutoCuraBanco({
  diagnostico,
  sonda_autorizada,
  agora_ms = Date.now(),
  armazenamento = armazenamentoPadrao,
  ao_agendar_reinicio = agendarEncerramentoDoApp,
}: OpcoesAvaliacao): Promise<ResultadoAutoCura> {
  try {
    const estado = await armazenamento.ler();
    const reiniciosPodados = podarReinicios(estado, agora_ms);

    if (!sonda_autorizada) {
      const status: StatusAutoCura =
        diagnostico === "ok"
          ? "pronto"
          : diagnostico === "banco_indisponivel"
            ? "banco_indisponivel_sem_reinicio"
            : estado.reinicios_em_ms.length >= MAX_REINICIOS_NA_JANELA
              ? "limite_de_reinicios_atingido"
              : "confirmando_pool_saturado";
      return { estado: estadoPublico(status, diagnostico, estado, false), deve_encerrar: false };
    }

    if (diagnostico === "ok") {
      const mudou = estado.falhas_consecutivas_pool !== 0 || reiniciosPodados;
      estado.falhas_consecutivas_pool = 0;
      if (mudou) await armazenamento.salvar(estado);
      return { estado: estadoPublico("pronto", diagnostico, estado, false), deve_encerrar: false };
    }

    if (diagnostico === "banco_indisponivel") {
      estado.falhas_consecutivas_pool = 0;
      await armazenamento.salvar(estado);
      return {
        estado: estadoPublico("banco_indisponivel_sem_reinicio", diagnostico, estado, false),
        deve_encerrar: false,
      };
    }

    estado.falhas_consecutivas_pool = Math.min(
      estado.falhas_consecutivas_pool + 1,
      FALHAS_DE_POOL_ANTES_DO_REINICIO,
    );

    if (estado.falhas_consecutivas_pool < FALHAS_DE_POOL_ANTES_DO_REINICIO) {
      await armazenamento.salvar(estado);
      return {
        estado: estadoPublico("confirmando_pool_saturado", diagnostico, estado, false),
        deve_encerrar: false,
      };
    }

    if (estado.reinicios_em_ms.length >= MAX_REINICIOS_NA_JANELA) {
      await armazenamento.salvar(estado);
      return {
        estado: estadoPublico("limite_de_reinicios_atingido", diagnostico, estado, false),
        deve_encerrar: false,
      };
    }

    estado.reinicios_em_ms.push(agora_ms);
    estado.falhas_consecutivas_pool = 0;
    await armazenamento.salvar(estado);
    ao_agendar_reinicio();
    return {
      estado: estadoPublico("reinicio_agendado", diagnostico, estado, true),
      deve_encerrar: true,
    };
  } catch {
    const estado = copiarEstado(ESTADO_INICIAL);
    return {
      estado: estadoPublico("controle_indisponivel", diagnostico, estado, false),
      deve_encerrar: false,
    };
  }
}

/** Aguarda a resposta de saúde sair antes de encerrar o processo com erro. */
export function agendarEncerramentoDoApp(
  encerrar: (codigo: number) => void = (codigo) => process.exit(codigo),
  atrasoMs = 500,
): void {
  const timer = setTimeout(() => encerrar(1), atrasoMs);
  if (typeof timer === "object" && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}
