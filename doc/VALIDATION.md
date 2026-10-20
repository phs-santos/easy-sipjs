# Evidências de validação — patch 3.1.1

Resultados informados na entrega anterior (ambiente Linux):

| Comando | Estado reportado | Observação |
| --- | --- | --- |
| `npm run typecheck` | PASSOU | Verificado na preparação do patch anterior |
| `npm run lint` | PASSOU | Verificado na preparação do patch anterior |
| `npm test` | NÃO CONCLUÍDO | `node_modules` do arquivo original continha binários nativos macOS; binding Linux de rolldown indisponível |
| `npm run build` | NÃO CONCLUÍDO | Binário esbuild disponível era macOS |
| Integração PBX | NÃO EXECUTADA | Sem PBX de teste neste ambiente |
| Reproduzir antes/depois | NÃO EXECUTADO | Falhas identificadas por inspeção e testes propostos |

Esta atualização acrescenta **somente documentação** em `doc/`; não altera código nem implica uma nova execução de testes. Rodar `npm ci` no computador de destino para obter binários compatíveis.

Não considerar FIX-001 a FIX-005 homologados em produção até concluir as verificações de `TESTING.md`.
