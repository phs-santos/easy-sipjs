# Auditoria de capturas SIP — 2026-10-20

## Escopo
Foram examinadas as três capturas PCAP fornecidas. Contêm mensagens SIP legíveis, incluindo cabeçalhos potencialmente sensíveis; os dados de autenticação, números, endereços e identificadores de chamada não são reproduzidos aqui.

## Evidências
- `henrilgrim-teste-2.pcap`: 33 pacotes. REGISTER com desafio 401 e posterior 200 OK; INVITE com autenticação; re-INVITE com CSeq 2484, múltiplos `200 OK` entre a primeira resposta e após o BYE, sem ACK correspondente **visível na captura** para essa transação.
- `henrilgrim-teste-3.pcap`: 65 pacotes. REGISTER 401/200 OK; re-INVITE com CSeq 5282, repetidos `200 OK` até após BYE, sem ACK correspondente **visível na captura** para essa transação. Outro INVITE (CSeq 5281) apresenta ACKs.
- `test-henrilgrim.pcap`: 83 pacotes. Há várias respostas `200 OK` para INVITE acompanhadas de ACKs; isso por si só não comprova ausência de ACK. Necessária análise de tags/branches e direções para concluir.

## Hipótese prioritária
Nos dois primeiros arquivos, retransmissões de 200 OK para re-INVITE são **compatíveis com ausência ou perda de ACK no trecho capturado**. Não se pode concluir se o problema está no SDK, no PBX, em um proxy intermediário ou na posição da captura. O ACK é obrigatório no fluxo de sucesso de INVITE/re-INVITE. Uma falha de ACK pode gerar retransmissões e comportamento inesperado de sessão.

## Reprodução e teste
1. Em um ambiente controlado, capturar simultaneamente a sinalização nos dois lados do PBX/proxy, com relógios sincronizados.
2. Estabelecer chamada e executar hold/unhold ou mudança de mídia que gere re-INVITE.
3. Correlacionar Call-ID, CSeq, From/To tags e Via branch; verificar se há `200 OK` final e ACK do mesmo diálogo/CSeq.
4. Repetir com SIP.js e JsSIP isoladamente; registrar versão do navegador, SDP e estado da sessão.
5. Confirmar correção apenas se o ACK chegar ao destino, não houver retransmissões anormais e a mídia continuar funcional.

## Segurança
Os PCAPs podem conter `Authorization` e respostas digest, números telefônicos e dados de rede. Não os publique em issues abertas nem os inclua em pacotes npm ou ZIPs de distribuição.

## Estado
**Investigação, não bug de código confirmado.** Nenhuma alteração de sinalização foi aplicada com base apenas nesses PCAPs.
