# Sprint 2 — Registro e reconexão (v3.1.1)

## Escopo e classificação

Esta entrega reforça o isolamento de callbacks obsoletos, sem modificar a API pública. São **riscos de concorrência identificados em inspeção estática**, não falhas comprovadas em PBX real.

## Caso 1 — callbacks de um registro encerrado

**Causa:** delegates criados em `doRegister()` podem continuar sendo invocados assincronamente após `disconnect()`, alterando o estado do cliente para `connected`, `registered` ou `error`.

**Reprodução automatizada (antes):** criar `SipClient` com provider simulado; conectar; desconectar; chamar `onConnect`, `onAccept` e `onReject` capturados antes da desconexão. Sem proteção, os callbacks alteram o estado após o encerramento.

**Correção:** contador `lifecycleGeneration` incrementado em cada novo registro e na solicitação de desconexão; callbacks de conexão e registro ignoram gerações antigas. Convites atrasados são rejeitados.

**Validação:** `test/client.test.ts` → `SipClient lifecycle regression`, primeiro caso. Estado final deve ser `disconnected`.

## Caso 2 — callbacks do WebSocket anterior

**Causa:** callbacks de um registro antigo podem chegar depois de uma nova conexão e derrubar o estado de uma sessão mais recente.

**Reprodução automatizada (antes):** conectar; guardar delegates; desconectar; conectar novamente; emitir `onDisconnect` e `onReject` pelos delegates antigos. O estado da nova conexão não pode ser alterado.

**Correção:** validação da geração em callbacks de conexão, desconexão e registro.

**Validação:** `test/client.test.ts` → `SipClient lifecycle regression`, segundo caso. Estado final deve ser `registered` antes da limpeza.

## Caso 3 — health check atrasado

**Risco:** `provider.ping()` pode resolver após `disconnect()` e alterar contadores de falha, afetando decisões de reconexão.

**Correção:** aplicar resultado do ping somente se o cliente continuar ativo, conectado e na mesma geração de registro (um ping da conexão anterior não conta como falha da nova).

**Validação:** `test/sprint2-regression.test.ts` → `caso 3` (2 testes).

## Caso 4 — reconexão em andamento

**Risco:** `provider.reconnect()` pode resolver após a intenção de desconexão, marcando o cliente como registrado e recuperando mídia indevidamente.

**Correção:** verificar a geração e a intenção após o `await` da reconexão, antes de atualizar o estado e recuperar mídia.

**Validação:** `test/sprint2-regression.test.ts` → `caso 4`. Teste manual com PBX: interromper a conexão durante um reconnect demorado, solicitar `disconnect()` e verificar que o cliente permanece desconectado.

## Validação de ambiente

- `npm run typecheck`: **PASSOU** nesta entrega.
- `npm test`, `npm run lint`, `npm run build`: **PASSARAM** em 2026-10-20 (macOS). Resultados antes/depois em `VALIDATION-SPRINT-2.md`.
- PBX Asterisk/Kamailio, navegador real e WebRTC: **NÃO EXECUTADOS**.

## Próximos itens não cobertos

Falhas SIP 401/403/408, REGISTER expirado, renovações simultâneas, diferenças específicas dos providers, hold/unhold e troca de dispositivos exigem cenários específicos e testes adicionais. Não são declarados corrigidos nesta entrega.
