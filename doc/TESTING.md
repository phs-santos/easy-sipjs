# Como reproduzir e validar as correções

## Preparação

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Para focar os testes adicionados:

```bash
npx vitest run test/jssip-provider.test.ts -t 'JsSIPSession resource cleanup'
```

**Reprodução antes/depois:** para comprovação real de regressão, executar o mesmo teste contra o commit anterior e contra o patch. Um teste novo pode não compilar no commit anterior por diferença de estrutura; nesse caso, portar o teste isoladamente sem alterar o comportamento sob teste.

## Matriz de cenários

| ID      | Passos para reproduzir no código anterior                                                              | Resultado incorreto a procurar           | Critério de correção                                     | Automação                         |
| ------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| FIX-001 | JsSIP: criar sessão, emitir `icecandidate`, encerrar antes de `iceGatheringTimeoutMs`, avançar relógio | `ready()` depois de encerrada            | Nenhuma chamada tardia a `ready()`                       | Adicionada, execução pendente     |
| FIX-002 | Registrar `peerconnection` e listeners, terminar sessão, verificar handlers ativos                     | Listeners persistem                      | `removeEventListener` com mesmos handlers                | JsSIP adicionada; SIP.js pendente |
| FIX-003 | JsSIP: iniciar screen sharing, encerrar chamada sem stop manual                                        | Indicador de captura permanece ativo     | Track de tela parada e referências limpas                | Manual; unitário pendente         |
| FIX-004 | SIP.js: simular falha ICE, iniciar recuperação, terminar sessão antes de callback                      | Renegociação/ação sobre sessão terminada | Nenhuma ação tardia                                      | Pendente                          |
| FIX-005 | Deixar operação em fila, agendar reconnect, chamar `unregister()`                                      | Reconnect continua após pedido de saída  | Retry cancelado imediatamente; estado final desconectado | Pendente                          |

## Validação manual com PBX de teste

Usar **credenciais fictícias** e servidor de homologação. Não publicar traces SIP com Authorization, nonces, senhas ou tokens.

1. Registrar e fazer chamada de saída com SIP.js; atender e encerrar. Repetir com JsSIP.
2. Repetir 20 chamadas sequenciais; monitorar listeners, tracks e timers para verificar acúmulo.
3. Interromper rede durante registro e chamada; restaurar rede; confirmar reconexão sem registros duplicados.
4. Solicitar `unregister()` durante retry; confirmar ausência de novas tentativas até um `register()` explícito.
5. Iniciar e interromper compartilhamento de tela; encerrar durante compartilhamento; verificar indicador de captura do navegador.
6. Testar hold/unhold, mute, DTMF e transferência para detectar regressões nas sessões.

**Aprovação:** os resultados devem ser registrados com data, navegador/versão, provider, PBX, cenário, esperado, obtido e logs sanitizados. Se falhar, anexar caso mínimo reproduzível e registrar como aberto.

## Checklist por correção

- [ ] Reproduzido na versão anterior
- [ ] Causa raiz confirmada
- [ ] Correção revisada nos dois providers quando aplicável
- [ ] Teste falha antes e passa depois
- [ ] Testes de regressão e comandos de qualidade aprovados
- [ ] Teste manual concluído quando depende de WebRTC/PBX
- [ ] Sem alteração incompatível da API pública
