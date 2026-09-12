# Aparências do CRM

Aprovado pelo Enedi na prévia visual, seguido de autorização para aplicar ao CRM em crm.agenciaveritasdigital.com.

## Escopo
- Quatro aparências: Veritas, Azul Asaas, ChatGPT claro e ChatGPT escuro.
- Preferência local por navegador, salva entre navegações e recargas. Valores antigos light/dark/system continuam interpretados.
- Entrada no cabeçalho e em Configurações, inclusive para interface simplificada.
- Shell e componentes compartilham tokens, incluindo portais montados no body. Nome, logotipo, permissões e dados preservam suas fontes existentes.
- Nenhuma migration, credencial, envio de mensagem ou nova dependência.

## Checklist de arquitetura
1. Entrada: radios de AppearanceSettings e armazenamento local.
2. Saída: ThemeProvider altera data-appearance/data-theme; veritas-theme.css pinta páginas e portais.
3. Registro: preferência no localStorage do navegador, sem evento de negócio ou auditoria no servidor porque não há mutação da organização.
4. Visibilidade: miniatura selecionada, radio marcado e nome do tema na tela.
5. Porta: TopBar e lib/navigation/catalogo.ts, grupo Organização, seção Sua conta.
6. Anti-morte: não se aplica a demanda de cliente. Storage indisponível mantém a escolha em memória.
7. Configuração: /app/settings/aparencia, quatro opções visíveis.
8. Continuidade IA/humano: inalterada; somente apresentação.
9. Retorno: usuário pode trocar novamente; preferências inválidas têm fallback determinístico.
10. Mapa: docs/architecture/aparencias.architecture.json.

## Verificação
Testes de preferência, hidratação e script inicial; teste de UI para teclado e seleção exclusiva; completude de navegação e tradução. Spec aparencias.spec.ts entra no CI com login real de teste, navegação, recarga, portal e largura de celular.
