import type { InterfaceSettings } from "@/lib/navigation/interface";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { ArrowRight } from "@/lib/ui/icons";
import type { Role } from "@/lib/auth/types";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, type Idioma } from "@/lib/i18n/idiomas";
import { hubSections, NAV_GROUPS, type NavGroupId } from "@/lib/navigation/registry";

interface NavHubProps {
  interfaceSettings?: InterfaceSettings;
  group: NavGroupId;
  isPlatformAdmin: boolean;
  role: Role | null;
  title: string;
  subtitle: string;
  /**
   * Idioma da interface. `traduzir` é pura — roda em Server Component sem
   * provider. O default mantém os demais hubs (ex.: /app/ai) como estão até
   * que a página deles passe o locale; o que não tem entrada no dicionário
   * degrada para pt-BR, que é o comportamento de antes.
   */
  locale?: Idioma;
}

/**
 * Vitrine de um grupo do registro de navegação.
 *
 * O sidebar carrega o uso diário; o hub carrega o inventário — todas as telas
 * do grupo, cada uma com a frase que explica para que serve. Era isso que
 * faltava: telas como Conhecimento e Credenciais existiam só como aba dentro de
 * `/app/ai`, invisíveis para quem ainda não estava lá.
 *
 * As seções vêm do campo `section` do registro e são a JORNADA de quem usa o
 * grupo (montar → ensinar → acompanhar), não uma taxonomia técnica. Reordenar a
 * jornada é reordenar o array do registro.
 */
/**
 * `aria-labelledby` separa múltiplos ids por ESPAÇO — então um id com espaço
 * ("hub-ia-Ensinar o agente") vira três referências quebradas e a seção fica sem
 * rótulo acessível. O slug é o que mantém a região anunciável.
 */
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function NavHub({
  group,
  isPlatformAdmin,
  role,
  title,
  subtitle,
  interfaceSettings,
  locale = IDIOMA_PADRAO,
}: NavHubProps) {
  const secoes = hubSections(group, isPlatformAdmin, role, interfaceSettings);
  const nomeDoGrupo = NAV_GROUPS.find((item) => item.id === group)?.label ?? title;

  return (
    <div className="flex h-full flex-col gap-8 p-4 sm:p-6">
      <header className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-xs sm:p-7">
        <div aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary" />
        <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          {traduzir(nomeDoGrupo, locale)}
        </p>
        <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {traduzir(title, locale)}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground text-pretty">
            {traduzir(subtitle, locale)}
          </p>
        )}
      </header>

      {secoes.map(({ section, items }, indice) => (
        <section
          key={section}
          aria-labelledby={`hub-${group}-${slug(section)}`}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-muted font-numeric-display text-xs font-semibold text-muted-foreground"
            >
              {indice + 1}
            </span>
            <h2
              id={`hub-${group}-${slug(section)}`}
              className="text-sm font-semibold tracking-tight"
            >
              {traduzir(section, locale)}
            </h2>
            <span aria-hidden className="h-px flex-1 bg-border" />
            <span className="font-numeric-display text-xs text-muted-foreground">
              {items.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group block rounded-xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="flex h-full items-start gap-4 p-4 transition-[border-color,box-shadow,transform] group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-sm">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                      <Icon size={20} weight="regular" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-balance">
                        {traduzir(item.label, locale)}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground text-pretty">
                        {traduzir(item.description, locale)}
                      </p>
                    </div>
                    <ArrowRight
                      size={16}
                      aria-hidden
                      className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    />
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
