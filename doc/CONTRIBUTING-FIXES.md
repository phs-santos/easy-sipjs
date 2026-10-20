# Padrão obrigatório para correções futuras

Toda correção deve conter os campos abaixo em `doc/CHANGELOG-FIXES.md` ou registro equivalente:

1. **ID e classificação:** bug confirmado, risco preventivo ou melhoria.
2. **Sintoma e impacto:** comportamento visível, gravidade e escopo.
3. **Causa raiz:** método/arquivo, sequência de eventos e evidência; diferenciar hipótese de confirmação.
4. **Como reproduzir:** pré-requisitos, passos determinísticos, dados fictícios, resultado anterior e evidência coletada.
5. **Mudança aplicada:** arquivos, razão técnica, compatibilidade da API e efeito em SIP.js/JsSIP.
6. **Como testar:** passos antes/depois, resultado esperado e comandos reproduzíveis.
7. **Teste de regressão:** caminho e nome; idealmente falha antes e passa depois.
8. **Resultados reais:** PASSOU, FALHOU ou NÃO EXECUTADO; nunca declarar execução não realizada.
9. **Riscos e pendências:** cenários PBX, WebRTC, navegador, rede, concorrência, segurança.

Para cada ZIP: manter `doc/CHANGELOG-FIXES.md`, `doc/TESTING.md` e `doc/VALIDATION.md` atualizados. Preferir patch mínimo; evitar breaking changes e preservar redaction de logs SIP.
