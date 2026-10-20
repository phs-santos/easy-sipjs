# Sprint 3 — continuação: troca de microfone

## Classificação
Riscos de concorrência identificados por inspeção estática; reprodução real em navegador/PBX ainda pendente.

## Caso 1 — chamada termina enquanto a permissão do microfone está pendente
- **Antes:** `setAudioInput()` aguardava `getUserMedia()` e poderia executar `replaceTrack()` após o término da chamada.
- **Reproduzir:** iniciar uma chamada; solicitar troca de microfone; deixar a permissão do navegador pendente; encerrar a chamada; conceder a permissão.
- **Depois:** o fluxo verifica se a sessão terminou ou se o peer connection mudou; encerra as tracks recém-capturadas e rejeita a operação.
- **Validar:** repetir o cenário nos dois providers e verificar que nenhuma track capturada permanece ativa nem é instalada na sessão encerrada.

## Caso 2 — duas trocas simultâneas
- **Antes:** duas chamadas de `setAudioInput()` podiam capturar tracks e realizar `replaceTrack()` em ordem diferente da solicitada.
- **Reproduzir:** durante uma chamada, disparar duas trocas de microfone sem aguardar a primeira.
- **Depois:** a segunda solicitação falha explicitamente enquanto a primeira estiver pendente.
- **Validar:** conferir que somente uma captura é solicitada e que a primeira operação conclui sem concorrência.

## Caso 3 — dispositivo sem track de áudio
- **Antes:** JsSIP retornava silenciosamente quando a captura não fornecia track.
- **Reproduzir:** simular `getUserMedia()` retornando stream sem audio tracks.
- **Depois:** a operação rejeita com erro e libera todas as tracks retornadas.
- **Validar:** simular a resposta vazia e conferir rejeição e stop das tracks.

## Arquivos alterados
- `src/core/jssip-provider.ts`
- `src/core/sipjs-provider.ts`

## Limitações e validação
- Testes com PBX e navegador não executados.
- `npm ci` não concluiu neste ambiente (timeout); por isso lint, typecheck, Vitest e build **não foram validados** nesta entrega.
- Não foi comprovada resolução dos demais itens da Sprint 3 (ICE, SDP e áudio remoto).

## Comandos locais
```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```
