# Payout manual sem vínculo transacional

**Categoria:** timing (A4) · **Moeda:** USD

## A história

Três saques do saldo do gateway para a conta bancária, no mesmo dia.

- `po_7001` e `po_7002` são saques **manuais**, disparados pelo operador na
  interface do gateway. O gateway não expõe quais transações financiaram cada
  saque — é uma limitação real do produto, não uma falha do arquivo. Os dois
  saíram por **US$ 500,00 cada**, com quinze minutos de diferença.
- `po_7003` é um saque automático de US$ 325,00, e esse o banco identifica:
  o crédito no extrato cita o payout.

No extrato: dois créditos de US$ 500,00 e um de US$ 325,00.

## Por que essa é a resposta certa

`po_7003` casa por referência. Um par, uma justificativa.

Os outros dois são o ponto do caso. Valor idêntico, mesmo dia, nenhum vínculo
transacional em lugar nenhum: **não existe evidência que diga qual saque virou
qual crédito**. Qualquer pareamento é chute com 50% de chance, e um chute que
entra nos livros como conciliado é pior que uma linha na fila de exceção.

A resposta certa é `ambiguous`, com os dois saques de um lado e os dois créditos
como candidatos do outro. O total fecha — US$ 1.000,00 de cada lado — e é
exatamente por isso que a tentação de casar existe.

Note o que **não** é a resposta: casar `po_7001` com o primeiro crédito só
porque os dois aparecem primeiro na ordem do arquivo. Ordem de arquivo não é
evidência, e o corpus é determinístico sob embaralhamento justamente para punir
quem trata como se fosse.

### Uma abstenção, não duas

A dúvida deste caso é um bloco: dois saques disputando dois créditos. O `expected.json`
escreve isso como **uma** entrada de `ambiguous` com quatro ids — `a` com os dois saques,
`candidates_b` com os dois créditos.

Não são duas abstenções de um-contra-dois. As duas formas descrevem a mesma incerteza para um
leitor humano, mas o score compara as entradas como conjuntos: quem emitir uma entrada por
registro leva `false_abstain` nas duas, num caso que respondeu certo. A convenção está no
`SPEC.md`, § "Três convenções que o score compara byte a byte".
