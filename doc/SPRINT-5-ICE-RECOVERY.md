# Sprint 5 — ICE recovery concorrente no JsSIP

## Classificação
Risco de concorrência confirmado por inspeção estática. Testes de regressão escritos, mas não executados neste ambiente. Não afirmar correção validada em produção.

## Causa raiz
`JsSIPSession.recoverMedia()` iniciava `session.renegotiate()` sem rastrear uma tentativa em andamento. A promise dependia do callback do JsSIP e podia permanecer pendente após o evento de encerramento da sessão.

## Como reproduzir antes da alteração
1. Criar sessão JsSIP com `connection.iceConnectionState = 'failed'`.
2. Simular `renegotiate()` retornando `true`, sem chamar imediatamente o callback.
3. Invocar `recoverMedia()` duas vezes sem aguardar a primeira.
4. Observar duas invocações de `renegotiate()` (ou rejeição inesperada da segunda).
5. Em outro teste, iniciar recuperação e disparar evento `ended` antes do callback; a promise original pode ficar pendente.

## Comportamento esperado depois
- Somente um re-INVITE em andamento para chamadas concorrentes de `recoverMedia()`.
- Encerramento da sessão rejeita a recuperação pendente com erro explícito.
- Callback tardio não altera o resultado de uma promise já encerrada.
- `renegotiate()` retornando `false` continua gerando erro.

## Alterações
- `src/core/jssip-provider.ts`: rastreamento de tentativa, cancelamento ao encerrar e proteção contra callbacks duplicados.
- `test/jssip-provider.test.ts`: três testes de regressão para concorrência, término e rejeição da oferta.

## Testar automaticamente
```bash
npm ci
npm test -- test/jssip-provider.test.ts
npm run lint
npm run typecheck
npm test
npm run build
```

Para comprovar a regressão, executar os testes novos na revisão anterior (Sprint 4): o teste de concorrência deve falhar. Na Sprint 5, todos devem passar.

## Teste manual com PBX
1. Estabelecer chamada com provider JsSIP.
2. Simular falha ICE usando ambiente controlado de rede e observar a recuperação.
3. Disparar solicitações próximas de recuperação e conferir no SIP trace se não há re-INVITEs simultâneos provocados por essas chamadas.
4. Encerrar a chamada durante renegociação e verificar que a operação termina com erro, sem recursos ou callbacks ativos.
5. Repetir com SIP.js para confirmar ausência de regressão na API pública.

## Validação e limites
- Typecheck: **não executável** neste ambiente por ausência de dependências instaladas (`@types/node`).
- Lint, Vitest e build: **não executados** nesta entrega.
- PBX real: **não executado**.
- Ainda é necessário investigar timeout de sinalização de renegociação quando o JsSIP não chama callback nem encerra sessão.
