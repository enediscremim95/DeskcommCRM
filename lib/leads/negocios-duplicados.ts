export interface NegocioDuplicado {
  id: string;
  title: string;
  source: string;
  value_cents: number | null;
  custom_fields: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
  tags: string[];
  created_at: string;
  contact_name: string | null;
  pipeline_name: string;
}

export interface GrupoDeNegociosDuplicados {
  group_key: string;
  contact_id: string;
  pipeline_id: string;
  classification: "vazio_com_contexto" | "todos_vazios";
  survivor: NegocioDuplicado;
  absorbed: NegocioDuplicado[];
}

export interface JuncaoDeNegociosRecente {
  id: string;
  survivor_lead_id: string;
  absorbed_lead_id: string;
  survivor_title: string;
  absorbed_title: string;
  merged_at: string;
  merged_by_user_id: string | null;
}

export interface ResultadoJuncaoDeNegocios {
  outcome: "merged" | "already_merged" | "undone" | "already_undone";
  log_id: string;
  survivor_lead_id: string;
  absorbed_lead_id: string;
}

export const ERROS_JUNCAO_NEGOCIOS: Record<
  string,
  { code: string; status: number; message: string }
> = {
  insufficient_role: {
    code: "forbidden_role",
    status: 403,
    message: "Juntar negócios exige papel de gerente ou acima.",
  },
  selecao_de_negocios_invalida: {
    code: "validation_failed",
    status: 422,
    message: "Escolha dois negócios diferentes.",
  },
  negocio_sobrevivente_nao_encontrado: {
    code: "not_found",
    status: 404,
    message: "O negócio que ficaria não está mais disponível.",
  },
  negocio_absorvido_nao_encontrado: {
    code: "not_found",
    status: 404,
    message: "O negócio duplicado não está mais disponível.",
  },
  negocios_de_contatos_diferentes: {
    code: "state_conflict",
    status: 409,
    message: "Os negócios não pertencem mais ao mesmo contato.",
  },
  negocios_de_funis_diferentes: {
    code: "state_conflict",
    status: 409,
    message: "Os negócios não pertencem mais ao mesmo funil.",
  },
  negocio_nao_esta_aberto: {
    code: "state_conflict",
    status: 409,
    message: "Os dois negócios precisam continuar abertos.",
  },
  negocio_absorvido_tem_valor: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado ganhou um valor e não pode mais ser juntado.",
  },
  negocio_absorvido_tem_campos: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado ganhou informações e não pode mais ser juntado.",
  },
  negocio_absorvido_tem_origem: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado ganhou dados de origem e não pode mais ser juntado.",
  },
  negocio_absorvido_tem_tags: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado ganhou marcadores e não pode mais ser juntado.",
  },
  negocio_absorvido_tem_tarefa: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado tem uma tarefa e não pode ser juntado.",
  },
  negocio_absorvido_tem_followup: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado tem um retorno próprio e não pode ser juntado.",
  },
  negocio_absorvido_tem_atividade: {
    code: "state_conflict",
    status: 409,
    message: "O negócio duplicado teve atividade e não pode mais ser juntado.",
  },
  historico_mudou_desde_a_juncao: {
    code: "state_conflict",
    status: 409,
    message: "Não é mais seguro desfazer porque o histórico mudou.",
  },
  historico_sem_chave_para_desfazer: {
    code: "state_conflict",
    status: 409,
    message: "Não é seguro juntar porque um registro relacionado não pode ser restaurado.",
  },
  historico_sem_chave_estavel_para_desfazer: {
    code: "state_conflict",
    status: 409,
    message: "Não é seguro juntar porque um registro relacionado não tem identidade estável.",
  },
  estado_da_juncao_mudou: {
    code: "state_conflict",
    status: 409,
    message: "Não é mais seguro desfazer porque um registro relacionado mudou.",
  },
  juncao_de_negocios_nao_encontrada: {
    code: "not_found",
    status: 404,
    message: "Esta junção não foi encontrada.",
  },
};

export function erroPrevistoDaJuncao(message: string | undefined) {
  const bruto = message ?? "";
  const chave = Object.keys(ERROS_JUNCAO_NEGOCIOS).find((item) => bruto.includes(item));
  return chave ? ERROS_JUNCAO_NEGOCIOS[chave] : undefined;
}
