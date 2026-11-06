import { z } from "zod";

const servicoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  company: z.union([z.string(), z.object({ name: z.string() })]),
  price: z.string().nullable().optional(),
  custom_price: z.string().nullable().optional(),
  discount: z.string().nullable().optional(),
  delivery_time: z.number().int().nonnegative().nullable().optional(),
  delivery_range: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() })
    .nullable()
    .optional(),
  error: z.string().nullable().optional(),
});

export interface OpcaoMelhorEnvio {
  id: number;
  nome: string;
  empresa: string;
  valor_cents: number;
  prazo_transporte_dias_uteis: number;
  prazo_minimo_dias_uteis: number | null;
  prazo_maximo_dias_uteis: number | null;
}

export interface CotacaoMelhorEnvioInput {
  baseUrl: string;
  userAgent: string;
  token: string;
  fromPostalCode: string;
  toPostalCode: string;
  package: { height: number; width: number; length: number; weight: number };
  insuranceValue: number;
  serviceAllowlist: readonly number[];
}

export class ErroMelhorEnvio extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ErroMelhorEnvio";
  }
}

function urlDeCalculo(baseBruta: string): string {
  let base: URL;
  try {
    base = new URL(baseBruta);
  } catch {
    throw new ErroMelhorEnvio(
      "frete_configuracao_invalida",
      "a configuração do frete está inválida; passe para uma pessoa.",
    );
  }
  const hostPermitido =
    base.protocol === "https:" &&
    (base.hostname === "melhorenvio.com.br" || base.hostname.endsWith(".melhorenvio.com.br"));
  const caminho = base.pathname.replace(/\/+$/u, "");
  if (!hostPermitido || caminho !== "/api/v2" || base.username || base.password) {
    throw new ErroMelhorEnvio(
      "frete_configuracao_invalida",
      "a configuração do frete está inválida; passe para uma pessoa.",
    );
  }
  base.pathname = `${caminho}/me/shipment/calculate`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function centavos(valor: string | null | undefined): number | null {
  if (!valor || !/^\d+(?:\.\d{1,2})?$/u.test(valor)) return null;
  const [inteiro, decimal = ""] = valor.split(".");
  return Number(inteiro) * 100 + Number(`${decimal}00`.slice(0, 2));
}

function erroHttp(status: number): ErroMelhorEnvio {
  if (status === 401 || status === 403) {
    return new ErroMelhorEnvio(
      "frete_autorizacao_indisponivel",
      "não consegui autorizar a cotação do frete; passe para uma pessoa.",
    );
  }
  if (status === 429) {
    return new ErroMelhorEnvio(
      "frete_limite_temporario",
      "a cotação do frete está temporariamente limitada; passe para uma pessoa.",
    );
  }
  return new ErroMelhorEnvio(
    "frete_resposta_indisponivel",
    "não consegui cotar o frete agora; passe para uma pessoa.",
  );
}

export async function cotarNoMelhorEnvio(
  input: CotacaoMelhorEnvioInput,
  deps: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<OpcaoMelhorEnvio[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 8_000;
  const url = urlDeCalculo(input.baseUrl);
  if (!input.userAgent.trim() || /[\r\n]/u.test(input.userAgent)) {
    throw new ErroMelhorEnvio(
      "frete_configuracao_invalida",
      "a configuração do frete está inválida; passe para uma pessoa.",
    );
  }
  const body = {
    from: { postal_code: input.fromPostalCode },
    to: { postal_code: input.toPostalCode },
    package: input.package,
    options: { receipt: false, own_hand: false, insurance_value: input.insuranceValue },
  };

  let response: Response | null = null;
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": input.userAgent,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      break;
    } catch {
      if (tentativa === 1) {
        throw new ErroMelhorEnvio(
          "frete_rede_indisponivel",
          "não consegui acessar a cotação do frete; passe para uma pessoa.",
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (!response) {
    throw new ErroMelhorEnvio(
      "frete_rede_indisponivel",
      "não consegui acessar a cotação do frete; passe para uma pessoa.",
    );
  }
  if (!response.ok) throw erroHttp(response.status);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ErroMelhorEnvio(
      "frete_resposta_invalida",
      "a cotação do frete voltou inválida; passe para uma pessoa.",
    );
  }
  const parsed = z.array(servicoSchema).safeParse(json);
  if (!parsed.success) {
    throw new ErroMelhorEnvio(
      "frete_resposta_invalida",
      "a cotação do frete voltou inválida; passe para uma pessoa.",
    );
  }
  const permitidos = new Set(input.serviceAllowlist);
  return parsed.data.flatMap((servico) => {
    if (servico.error || !permitidos.has(servico.id) || servico.delivery_time == null) return [];
    const valor = centavos(servico.custom_price) ?? centavos(servico.price);
    if (valor === null) return [];
    return [
      {
        id: servico.id,
        nome: servico.name,
        empresa: typeof servico.company === "string" ? servico.company : servico.company.name,
        valor_cents: valor,
        prazo_transporte_dias_uteis: servico.delivery_time,
        prazo_minimo_dias_uteis: servico.delivery_range?.min ?? null,
        prazo_maximo_dias_uteis: servico.delivery_range?.max ?? null,
      },
    ];
  });
}
