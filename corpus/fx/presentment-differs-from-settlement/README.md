# Moeda de apresentação diferente da moeda de liquidação

**Categoria:** câmbio (C1) · **Moedas:** JPY (expoente 0) → USD (expoente 2)

## A história

A loja é americana e vende para o Japão. O cliente paga em ienes, o gateway liquida em
dólares. Três vendas no dia 8 de junho, à taxa contratada de **0,0067 USD por iene** — no
arquivo, o par de inteiros `67/10000`, nunca um decimal.

- `ch_7001` — ¥15.001. Convertido: 15.001 × 0,67 centavo = **10.050,67 centavos**.
  Arredondado para o centavo mais próximo: **US$ 100,51**.
- `ch_7002` — ¥7.050. Convertido: **4.723,50 centavos**, exatamente meio centavo.
  `half_even` manda para o par: **US$ 47,24**.
- `ch_7003` — ¥7.150. Convertido: **4.790,50 centavos**, o outro meio centavo.
  Aqui o vizinho de baixo já é par, e `half_even` manda para **US$ 47,90** — enquanto
  arredondar meio-para-cima daria US$ 47,91.

O extrato tem os três créditos, em dólar, **sem referência nenhuma**. O banco não sabe o que
é um iene; ele só viu dinheiro entrar.

## Por que essa é a resposta certa

Nenhum dos pares fecha comparando `gross` com `gross`: de um lado há ienes, do outro dólares,
e 15.001 nunca vai ser 10.051. O par só existe **depois de converter** — daí a regra
`fx_converted`.

O iene tem expoente 0: ¥15.001 são 15.001 unidades mínimas, não 150,01. Quem assume centavos
em toda moeda erra a conversão por um fator de cem e não casa nada. É o caso mais barato do
corpus para pegar esse bug.

As duas últimas vendas existem para separar `half_even` de meio-para-cima, e uma sozinha não
separaria: em 4.723,50 as duas regras dão US$ 47,24, e o acerto é acidente. Em 4.790,50 elas
divergem — `half_even` desempata para o **par**, US$ 47,90, e meio-para-cima dá US$ 47,91,
que não existe no extrato. A `policy.json` declara `rounding: half_even`, e a implementação
que ignora esse campo e crava a regra que aprendeu na escola perde este par.

Resíduo zero nos três. A conversão fecha na unidade mínima, não "quase".
