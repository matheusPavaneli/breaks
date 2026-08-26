# Changelog do corpus

O corpus é versionado por conta própria, em `corpus/VERSION`, e todo score publicado carrega
a versão em que rodou. Alterar um caso existente é breaking: bump de minor e uma entrada
aqui, com o motivo. Adicionar caso novo também entra, porque muda o denominador de qualquer
placar.

Este arquivo registra as versões do corpus, que é licenciado CC BY 4.0. O código do repositório é MIT
e tem histórico próprio.

## 0.1.0 — 2026-08-26

Primeiros 12 casos, escritos à mão, narrativa antes do `expected.json`. Nenhum deles foi
produzido por motor: não existe motor de referência ainda, e `SPEC.md` § "Circularidade do
oráculo" põe a ordem nessa direção de propósito.

A seleção cobre as sete regras de casamento do schema pelo menos uma vez cada — `reference`,
`amount_and_window`, `amount_within_tolerance`, `group_sum`, `split_sum`, `fx_converted`,
`fee_leg` — e deixa quatro casos cuja resposta certa inclui abstenção.

**Timing (A)**

- `timing/charge-crosses-month-boundary` — venda no dia 31, liquidação no dia 2; uma venda
  ainda não liquidada na virada.
- `timing/manual-payout-without-transaction-link` — dois saques manuais de valor idêntico,
  sem vínculo transacional. Abstenção.

**Pernas de taxa (B)**

- `fee-legs/fee-not-returned-on-refund` — a taxa não volta no reembolso; a perna de taxa
  casa separada do bruto.
- `fee-legs/dispute-fee-separate-from-disputed-amount` — taxa de disputa sem contrapartida
  no período.

**Câmbio (C)**

- `fx/presentment-differs-from-settlement` — JPY (expoente 0) → USD, com dois empates de
  meio centavo: um em que `half_even` e meio-para-cima concordam, e outro em que divergem.
- `fx/round-before-versus-after-conversion` — BHD (expoente 3) → USD; uma armadilha para
  quem arredonda antes de converter, e um empate real de arredondamento. Abstenção.

**Agrupamento (D)**

- `grouping/many-charges-one-payout` — n:1.
- `grouping/one-deposit-covers-two-payouts` — 1:n.

**Adversariais (E)**

- `adversarial/identical-amount-same-minute` — abstenção.
- `adversarial/one-cent-inside-versus-outside-tolerance` — dentro, fora e empate na
  tolerância declarada pela `policy.json`. Abstenção.
- `adversarial/record-present-in-a-absent-in-b` — sobrar dos dois lados não é sinal de par.
- `adversarial/sums-match-categories-contradict` — valor e data batem, categoria não.

Faltam 28 casos para o corpus v1 descrito no `SPEC.md`. Enquanto isso, a versão é 0.x e
nenhum placar deve ser lido como cobertura completa das cinco categorias.
