# Runbook, primeira release do fork Veritas

Este fork publica somente imagens próprias, no namespace `ghcr.io/enediscremim95`.
O workflow herdado de release permanece restrito ao upstream. No fork, a publicação
é deliberada: uma tag anotada criada no topo validado da `main` dispara o CI.

## Pré-condições

1. O diff foi revisado e a `main` está verde.
2. `pnpm test:shell`, os testes unitários de packaging e `pnpm release:conferir` passaram.
3. Os pacotes GHCR `deskcommcrm`, `deskcomm-worker` e `deskcomm-scheduler` poderão ser
   tornados públicos após a primeira publicação.

## Publicar a primeira tag de teste

No checkout que aponta para o fork, já sincronizado com `origin/main`:

```bash
git checkout main
git pull --ff-only origin main
git tag -a v1.0.0-veritas.1 -m "v1.0.0-veritas.1"
git push origin v1.0.0-veritas.1
```

O formato aceito é estritamente `vX.Y.Z-veritas.N`. O CI confere que o commit
da tag está contido na `main`, publica as três imagens com a mesma tag e só
então move `stable`.

Após o run verde, torne os três pacotes públicos no GHCR e confirme que cada
imagem responde à mesma tag. Não faça deploy em VPS nesta etapa.
