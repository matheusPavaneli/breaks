# n:1 — várias cobranças em um único payout

**Categoria:** agrupamento (D1) · **Moeda:** USD

## A história

O gateway acumula o líquido das vendas do dia e manda **um** depósito para o
banco. No dia 7 de julho foram três vendas liquidadas:

- `ch_1101` — líquido US$ 42,10
- `ch_1102` — líquido US$ 36,75
- `ch_1103` — líquido US$ 21,15

Soma: **US$ 100,00**, e é isso que o extrato mostra: um crédito de US$ 100,00,
sem referência a nenhuma venda. O banco viu um depósito, não três vendas.

Há uma quarta venda, `ch_1104`, de US$ 25,00 líquidos, criada às 23:50. Ela
não entrou no lote e ainda está `pending`.

O caso real do SPEC tem 340 cobranças em um payout. Três bastam para o
formato: o que muda com 340 é o custo de buscar a partição, não a resposta.

## Por que essa é a resposta certa

Um par, três registros de um lado e um do outro, regra `group_sum`, resíduo
zero. A justificativa é a soma dos líquidos — `fields_used` diz exatamente
isso, e um casamento sem essa justificativa não passa no schema.

Duas coisas que o caso cobra:

- **Não parear individualmente.** Nenhuma das três vendas tem o valor do
  depósito. Casar `ch_1101` com o crédito de US$ 100,00 e chamar de resíduo os
  US$ 57,90 restantes é um falso positivo com aparência de quebra pequena.
- **Não arrastar a quarta venda.** `ch_1104` não faz parte da soma, e nenhuma
  combinação com ela chega a US$ 100,00 — as somas possíveis são US$ 103,85,
  US$ 88,25 e US$ 82,90. A partição que fecha é única, e ela é a resposta.
  `ch_1104` fica como `not_yet_settled`.
