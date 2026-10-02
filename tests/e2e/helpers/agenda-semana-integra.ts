import { expect, type Page } from "@playwright/test";

/**
 * A SEMANA ÍNTEGRA — o único lugar destas specs onde "que dia é hoje" entra na
 * conta, e ele entra DECLARADO.
 *
 * ═══ O defeito que este módulo existe para fechar ════════════════════════════
 *
 * `agenda-grade-interativa`, `agenda-marcar-pela-tela` e
 * `agenda-remarcar-e-cancelar` reprovaram a `main` em 2026-08-28 a partir das
 * ~15:50 BRT, em quatro runs seguidos, com códigos DIFERENTES — inclusive um PR
 * com um único arquivo em `.changes/`, que não tem como quebrar e2e por mérito
 * próprio. A mensagem entrega a causa:
 *
 *     Error: nenhum bloco livre na semana desenhada
 *     Locator: locator('[data-testid^="bloco-2026-08-28-"][data-livre="true"]')
 *
 * A grade pede horários para EXATAMENTE a semana que desenha
 * (`AgendaInterativa`, `recorte`), e a semana desenhada é a de HOJE. A jornada
 * do seed é seg–sex 09:00–18:00 com 60 min de aviso mínimo, então o que a
 * semana corrente ainda oferece é **o resto de hoje** — e ele encolhe sozinho.
 *
 * Medido com o motor real (`lib/agenda/horarios-livres.ts`), sem browser,
 * numa sexta-feira, contando os horários livres da semana desenhada:
 *
 *     dia          09h  12h  15h  16h  17h  20h  23h
 *     sex (hoje)    16   10    4    2    0    0    0
 *     sáb            0    0    0    0    0    0    0
 *     semana +1     90   90   90   90   90   90   90
 *
 * Duas leituras, e a segunda é a que assusta: **no sábado é zero o dia
 * inteiro**, porque a semana desenhada (dom→sáb) só tem dias úteis já passados.
 * Não é "o teste fica frágil à tarde"; é "o teste não pode passar no fim de
 * semana". E entre 15h e 17h o bolso ainda tem 2 a 4 vagas — que as specs
 * ANTERIORES do mesmo job consomem marcando —, o que explica o corte ter caído
 * às ~15h50 e não às 17h.
 *
 * ═══ Por que a semana SEGUINTE, e não um seed maior ══════════════════════════
 *
 * Alargar a jornada do seed (fim de semana, horário noturno) só empurra a hora
 * em que a conta volta a ficar curta — e não salva nenhuma das duas pontas: às
 * 23h o resto de hoje é zero de qualquer jornada, e o sábado continua sendo uma
 * semana de dias passados. A semana seguinte é íntegra **em qualquer hora e em
 * qualquer dia da semana**: 90 vagas, sempre, como a terceira linha da tabela
 * mostra.
 *
 * ═══ A regra que estas funções encarnam ══════════════════════════════════════
 *
 * O dia-alvo NÃO sai do relógio do Node. Ele sai do que a TELA desenhou depois
 * da navegação (`coluna-dia-<yyyy-MM-dd>`), que é a mesma verdade que a grade
 * usará para desenhar o compromisso marcado. Enquanto o alvo vinha de um lado e
 * a grade do outro, `agenda-marcar-pela-tela` marcava na segunda-feira e
 * procurava o cartão na semana de sexta — e a falha lia "a grade não repinta".
 */

/** O passo da visão "semana" — o botão avança sete dias por clique. */
const DIAS_POR_SEMANA = 7;

/**
 * Leva a agenda para a semana seguinte e devolve os dias que ela passou a
 * desenhar, em `yyyy-MM-dd`.
 *
 * Espera a grade REPINTAR antes de devolver: o `useHorariosLivres` refaz a
 * busca quando o recorte muda, e medir no meio da troca lê a semana velha.
 */
export async function irParaASemanaSeguinte(page: Page): Promise<string[]> {
  const colunas = page.locator('[data-testid^="coluna-dia-"]');
  await expect(
    colunas.first(),
    "a grade não desenhou dia nenhum — a tela da agenda não chegou a montar",
  ).toBeAttached({ timeout: 25_000 });
  const antes = await diasDesenhados(page);

  await page.getByTestId("periodo-seguinte").click();

  await expect
    .poll(async () => (await diasDesenhados(page))[0] ?? "", {
      timeout: 20_000,
      message: "a grade não trocou de semana depois do clique em `periodo-seguinte`",
    })
    .not.toBe(antes[0] ?? "");

  const depois = await diasDesenhados(page);
  expect(
    depois.length,
    "a semana desenhada não tem sete dias — o recorte da grade mudou de forma",
  ).toBe(DIAS_POR_SEMANA);
  return depois;
}

/**
 * Leva a grade até a semana que contém um COMPROMISSO já marcado, e devolve o
 * dia dele em `yyyy-MM-dd`.
 *
 * ⚠️ Quem marca por API não escolhe a semana — recebe. `agente-marca-consulta`
 * pede o PRIMEIRO horário livre dos próximos 14 dias e manda a IA marcar nele;
 * antes das 17h esse primeiro é hoje, e a grade — que desenha a semana de hoje —
 * mostra o cartão sem ninguém navegar. Depois das 17h o primeiro livre é a
 * segunda-feira, o cartão nasce na semana seguinte, e a asserção "o compromisso
 * aparece na Agenda" reprova com `element(s) not found`. Medido no CI às 21h01
 * UTC, no run do PR que consertava as outras cinco specs: a mesma classe, na
 * sexta spec.
 *
 * O dia sai de um `page.evaluate` de propósito: a grade formata as chaves no
 * fuso do BROWSER, e converter o instante no Node daria uma data diferente
 * sempre que os dois fusos discordassem.
 */
export async function irParaASemanaDoCompromisso(page: Page, instanteISO: string): Promise<string> {
  const dia = await page.evaluate((iso) => {
    const d = new Date(iso);
    const dd = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
  }, instanteISO);

  await expect(
    page.locator('[data-testid^="coluna-dia-"]').first(),
    "a grade não desenhou dia nenhum — a tela da agenda não chegou a montar",
  ).toBeAttached({ timeout: 25_000 });

  // Teto explícito: a consulta que alimenta estas specs olha 14 dias à frente,
  // então três saltos bastam. Sem teto, uma chave que a grade nunca desenha
  // viraria um laço de cliques até o timeout do caso — e a falha diria
  // "timeout", que é indistinguível de defeito.
  for (let salto = 0; salto < 4; salto++) {
    if ((await diasDesenhados(page)).includes(dia)) return dia;
    await irParaASemanaSeguinte(page);
  }
  expect(
    await diasDesenhados(page),
    `a grade não chegou à semana de ${dia} em quatro saltos — o compromisso está ` +
      "fora da janela que a tela sabe desenhar",
  ).toContain(dia);
  return dia;
}

/** Os dias que a grade desenha AGORA, lidos da própria tela. */
export async function diasDesenhados(page: Page): Promise<string[]> {
  return (
    await page
      .locator('[data-testid^="coluna-dia-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.replace("coluna-dia-", "")))
  ).sort();
}

/**
 * Espera a consulta de horários terminar sem exigir vaga no mês que está aberto.
 *
 * No último dia útil do mês, depois do aviso mínimo, a resposta correta pode ter
 * vagas somente no mês seguinte. O botão `mes-seguinte` habilitado é a prova de
 * que a consulta terminou e trouxe esse recorte futuro. Esperar primeiro por um
 * dia clicável no mês atual cria um impasse: o teste nunca chega ao clique que
 * revela as vagas que já vieram da API.
 *
 * O trace do CI de 30/09/2026 provou o caso completo: a rota respondeu 200 para
 * o tipo escolhido, com vagas de 01/10 a 30/10, enquanto setembro não tinha um
 * único `dia-*` disponível. O run das 14:04 passou e os das 16:24 e 17:46
 * falharam porque o relógio cruzou o último horário possível de setembro.
 */
async function abrirMesQueTemVaga(
  page: Page,
  mensagemSemVaga: string,
  mensagemMesSeguinte: string,
): Promise<boolean> {
  const diaDisponivel = page.locator('[data-testid^="dia-"][data-disponivel="true"]').first();
  const mesSeguinte = page.getByTestId("mes-seguinte");

  await expect
    .poll(
      async () => (await diaDisponivel.isVisible()) || (await mesSeguinte.isEnabled()),
      { message: mensagemSemVaga, timeout: 20_000 },
    )
    .toBe(true);

  if (await diaDisponivel.isVisible()) return false;

  await mesSeguinte.click();
  await expect(diaDisponivel, mensagemMesSeguinte).toBeVisible({ timeout: 20_000 });
  return true;
}

/**
 * Escolhe, no painel de marcação já aberto, um dia que a grade esteja
 * desenhando — e devolve a chave escolhida.
 *
 * O mini-calendário do painel abre no mês de HOJE (`ancora={new Date()}` em
 * `_client.tsx`), e a semana seguinte pode cair inteira no mês que vem: numa
 * sexta dia 31, os cinco dias úteis da semana seguinte são todos do mês
 * seguinte, e nenhum deles é clicável na grade em tela. Por isso o salto de mês
 * é um passo previsto, e não um remendo — sem ele esta função reprovaria dois
 * dias por mês, que é a mesma classe de vermelho-por-calendário que ela existe
 * para fechar.
 */
export async function escolherDiaDesenhado(page: Page, dias: readonly string[]): Promise<string> {
  const disponiveis = async (): Promise<string[]> =>
    (
      await page
        .locator('[data-testid^="dia-"][data-disponivel="true"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.slice(4)))
    ).filter((k) => dias.includes(k));

  // Até a consulta responder, tanto os dias quanto a navegação futura nascem
  // indisponíveis. Aceitar o segundo sinal evita exigir vaga no mês atual para
  // só então permitir que o teste abra o mês onde as vagas realmente estão.
  const jaAvancouOMes = await abrirMesQueTemVaga(
    page,
    "nenhum dia disponível no painel, e a consulta não liberou o mês seguinte",
    "nem o mês seguinte oferece dia, a janela de busca do painel é de 30 dias",
  );

  let candidatos = await disponiveis();
  if (candidatos.length === 0 && !jaAvancouOMes) {
    await page.getByTestId("mes-seguinte").click();
    await expect(
      page.locator('[data-testid^="dia-"][data-disponivel="true"]').first(),
      "nem o mês seguinte oferece dia — a janela de busca do painel é de 30 dias",
    ).toBeVisible({ timeout: 20_000 });
    candidatos = await disponiveis();
  }

  const escolhido = candidatos.sort()[0];
  expect(
    escolhido,
    `nenhum dia da semana desenhada (${dias.join(", ")}) está disponível no painel — ` +
      "o alvo e a grade deixariam de falar do mesmo período",
  ).toBeTruthy();
  await page.getByTestId(`dia-${escolhido}`).click();
  return escolhido!;
}

/**
 * O primeiro dia CHEIO — o primeiro que o painel oferece depois de hoje, com a
 * jornada inteira em vez do resto de um dia já gasto.
 *
 * ⚠️ ELE NÃO PASSA PELA GRADE, e é por isso que existe ao lado de
 * `escolherDiaDesenhado`. Quem só quer um dia com a lista de horários COMPLETA
 * (a spec de geometria do painel mede a coluna em cinco larguras, algumas
 * abaixo de `lg`, onde a grade nem desenha colunas de dia) não pode depender de
 * a grade ter sido navegada. As duas funções resolvem a mesma classe —
 * "não deixe o período ser escolhido pelo relógio" — por dois caminhos, e moram
 * juntas para que a próxima pessoa encontre a regra inteira num arquivo só.
 *
 * Veio de `agenda-painel-cabe-na-tela.spec.ts` (PR #402), onde nasceu depois de
 * a `main` reprovar duas vezes com contagens DIFERENTES no mesmo commit: 9
 * horários às 15:27 UTC e 7 às 16:37, porque o dia escolhido era hoje.
 */
/**
 * Os dias que o painel oferece DEPOIS de hoje — a jornada inteira, em vez do
 * resto de um dia já gasto. Ordenados, `yyyy-MM-dd`.
 *
 * ⚠️ NÃO PASSA PELA GRADE, e é por isso que existe ao lado de
 * `escolherDiaDesenhado`. Quem só quer um dia com a lista de horários COMPLETA
 * (a spec de geometria do painel mede a coluna em cinco larguras, algumas
 * abaixo de `lg`, onde a grade nem desenha colunas de dia) não pode depender de
 * a grade ter sido navegada. As duas rotas resolvem a mesma classe — "não deixe
 * o período ser escolhido pelo relógio" — e moram juntas para que a próxima
 * pessoa encontre a regra inteira num arquivo só.
 *
 * Veio de `agenda-painel-cabe-na-tela.spec.ts` (PR #402), onde nasceu depois de
 * a `main` reprovar duas vezes com contagens DIFERENTES no mesmo commit: 9
 * horários às 15:27 UTC e 7 às 16:37, porque o dia escolhido era hoje.
 */
async function diasCheios(page: Page): Promise<string[]> {
  const varrer = async (): Promise<string[]> => {
    const hoje = await page.evaluate(() => {
      // Calculado DENTRO do browser de propósito: é o mesmo relógio e o mesmo
      // fuso que formatam o `data-testid` de cada dia. Comparar com a data do
      // processo do Node erraria por um dia sempre que os dois discordassem.
      const d = new Date();
      const dd = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
    });
    const chaves = await page
      .locator('[data-testid^="dia-"][data-disponivel="true"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")!.slice(4)));
    // `yyyy-MM-dd` compara como texto na mesma ordem em que compara como data.
    return chaves.filter((k) => k > hoje).sort();
  };

  const jaAvancouOMes = await abrirMesQueTemVaga(
    page,
    "nenhum dia disponível, e a consulta não liberou o mês seguinte; sem dia clicável " +
      "a coluna de horários nunca abre (o defeito ficaria invisível)",
    "nem o mês seguinte oferece dia, a janela de busca da tela é de 30 dias",
  );

  const cheios = await varrer();
  if (cheios.length > 0) return cheios;

  // Se `abrirMesQueTemVaga` já avançou, todo dia visível está depois de hoje.
  // Chegar aqui vazio seria contradição entre o DOM que habilitou o botão e a
  // varredura; não navegue para um terceiro mês fora da janela consultada.
  if (jaAvancouOMes) {
    expect(
      cheios,
      "o mês seguinte mostrou dia disponível, mas a varredura não encontrou um dia depois de hoje",
    ).not.toHaveLength(0);
    return cheios;
  }

  // Hoje é o último dia útil do mês visível: o próximo dia com jornada cai no
  // mês seguinte, e o mini-calendário só torna clicável o que é `isSameMonth` do
  // mês em tela. Sem este passo as specs reprovariam nos dias 30/31 — a mesma
  // classe de vermelho-por-calendário que este módulo existe para fechar.
  await page.getByTestId("mes-seguinte").click();
  await expect(
    page.locator('[data-testid^="dia-"][data-disponivel="true"]').first(),
    "nem o mês seguinte oferece dia — a janela de busca da tela é de 30 dias",
  ).toBeVisible({ timeout: 20_000 });
  return varrer();
}

function exigirDia(cheios: readonly string[], qual: string): string {
  const dia = qual === "primeiro" ? cheios[0] : cheios[cheios.length - 1];
  expect(
    dia,
    "nenhum dia FUTURO disponível — sem um dia com a jornada inteira, a contagem de " +
      "horários volta a depender da hora em que a suíte roda",
  ).toBeTruthy();
  return dia!;
}

/** O PRIMEIRO dia cheio que o painel oferece. Clica nele e devolve a chave. */
export async function escolherPrimeiroDiaCheio(page: Page): Promise<string> {
  const dia = exigirDia(await diasCheios(page), "primeiro");
  await page.getByTestId(`dia-${dia}`).click();
  return dia;
}

/**
 * O ÚLTIMO dia cheio que o painel oferece — o mais longe da semana corrente.
 *
 * Quem precisa disto é `agenda-ver-na-agenda`: ela prova que o botão "Ver na
 * agenda" MOVE a grade até o compromisso, e com um dia da semana corrente a
 * grade já o mostraria sem navegar — o caso passaria com o botão mudo. O que
 * ela NÃO pode é cair em hoje, e caía: `dias.last()` é o último dia disponível
 * do MÊS EM TELA, e no último dia útil do mês esse último é o próprio hoje, com
 * o resto do dia por lista.
 */
export async function escolherUltimoDiaCheio(page: Page): Promise<string> {
  const dia = exigirDia(await diasCheios(page), "ultimo");
  await page.getByTestId(`dia-${dia}`).click();
  return dia;
}
