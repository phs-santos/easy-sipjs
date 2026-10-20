# Validação do ZIP recebido — 2026-10-20

Base: `easy-sipjs(3).zip`, package.json versão 3.1.1.

| Comando            | Resultado     | Observação                                                                    |
| ------------------ | ------------- | ----------------------------------------------------------------------------- |
| `tsc --noEmit`     | PASSOU        | Dependências extraídas do ZIP anterior para execução local                    |
| `eslint .`         | PASSOU        | Mesma ressalva                                                                |
| `vitest run`       | BLOQUEADO     | `rolldown` sem binding nativo Linux (`rolldown-binding.wasi.cjs`)             |
| `tsc` (emit)       | PASSOU        | Compilação TypeScript                                                         |
| `esbuild` bundle   | BLOQUEADO     | Executável macOS incluído nas dependências anteriores, incompatível com Linux |
| `npm ci --offline` | BLOQUEADO     | Dependência não presente no cache npm                                         |
| `npm ci`           | NÃO CONCLUÍDO | Instalação excedeu o tempo disponível                                         |

**Importante:** não declarar suíte de testes nem bundle aprovados. Executar `npm ci && npm run lint && npm run typecheck && npm test && npm run build` em ambiente local limpo. Verificar `npm pack --dry-run` antes de publicar.
