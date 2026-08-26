# Payout manual sem vínculo transacional

**Categoria:** timing (A4) · **Moeda:** USD

## A história

Três saques do saldo do gateway para a conta bancária, no dia 14 de abril.

- `po_7001` e `po_7002` são saques **manuais**, disparados pelo operador na interface do
  gateway. O gateway não expõe quais transações financiaram cada saque — é uma limitação real
  do produto, não uma falha do arquivo. Os dois saíram por **US$ 500,00 cada**, com quinze
  minutos de diferença.
- `po_7003` é um saque automático de US$ 325,00, e esse o banco identifica: o crédito no
  extrato cita o payout.

No extrato do período: **um** crédito de US$ 500,00 e um de US$ 325,00. O segundo saque de
US$ 500,00 cruzou depois do corte do banco e só aparece no extrato do dia seguinte.

## Por que essa é a resposta certa

`po_7003` casa por referência. Um par, uma justificativa.

Os dois saques manuais são o ponto do caso. Um deles chegou; o outro está em trânsito. Dizer
qual é **uma afirmação com consequência**: o saque que não casou vira uma linha de exceção que
alguém vai investigar, e o que casou entra nos livros como recebido. Errar troca as duas
coisas de lugar.

E não há como saber. Valor idêntico, mesmo dia, mesma conta de destino, e nenhum vínculo
transacional em lugar nenhum — nem no saque, nem no crédito. Escolher é acertar metade das
vezes.

A resposta certa é `ambiguous`: os dois saques de um lado, o único crédito como candidato do
outro, motivo `payout_without_transaction_link`.

O que **não** é a resposta: casar `po_7001` porque ele aparece primeiro no arquivo, ou porque
saiu mais cedo. Ordem de arquivo não é evidência, e "saiu primeiro, chegou primeiro" não vale
para transferência bancária — o corpus é determinístico sob embaralhamento justamente para
punir quem trata as duas coisas como se fossem.

### Uma abstenção, não duas

A dúvida é um bloco: dois saques disputando um crédito. O `expected.json` escreve isso como
**uma** entrada de `ambiguous` com três ids, não como duas entradas de um saque cada.

O score compara as entradas como conjuntos: quem emitir uma por registro descreve a mesma
incerteza para um leitor humano e leva `false_abstain` nas duas. A convenção está no
`SPEC.md`, § "Três convenções que o score compara byte a byte".
