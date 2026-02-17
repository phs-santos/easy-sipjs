# Changelog

## [2.2.0] - 2026-02-17

### Adicionado
- **Suporte ao JsSIP**: Adicionado `JsSIPProvider` para permitir o uso da biblioteca [JsSIP](https://jssip.net/) como motor de sinalização.
- **Abstração Agnóstica**: Introduzido `SipInvitation`, `ISipUserAgentDelegate` e `ISipRegisterDelegate` para remover a dependência direta de tipos do `sip.js` na API pública.
- **Callback `onTerminate`**: Adicionado evento `onTerminate` em `SipInvitation` e `ISipSession` para detectar o fim de chamadas de forma uniforme.

### Alterado
- **SipClient**: O construtor agora aceita uma opção `provider` ('sipjs' | 'jssip') ou um `customProvider` que implemente `ISipProvider`.
- **Demo**: Atualizado o projeto de exemplo para utilizar as novas abstrações genéricas e suporte a múltiplos providers.

### Corrigido
- **JsSIP Constructor**: Corrigido erro `UA is not a constructor` ao instanciar o UA do JsSIP.
- **Module Resolution**: Corrigido erro de "Cannot find module 'easy-sipjs'" no demo devido a caminho relativo incorreto no `package.json`.

### Removido
- **Logger**: Removido `src/utils/logger.ts` que não estava sendo utilizado.
- **Tipos Não Utilizados**: Limpeza de interfaces e propriedades legadas em `CallOptions` e `SipSession`.
