# Moeda de apresentação diferente da moeda de liquidação

**Categoria:** câmbio (C1) · **Moedas:** JPY (expoente 0) → USD (expoente 2)

## A história

A loja é americana e vende para o Japão. O cliente paga em ienes, o gateway liquida em
dólares. Três vendas no dia 8 de junho, à taxa contratada de **0,0067 USD por iene** — no
arquivo, o par de inteiros `67/10000`, nunca um decimal. O iene tem expoente 0, então um iene
vale 0,67 centavo de dólar.

- `ch_7001` — ¥15.001. Convertido: **10.050,67 centavos** → o banco credita **US$ 100,51**,
  sozinho, numa linha própria.
- `ch_7002` — ¥7.150 → **4.790,50 centavos**, exatamente meio centavo.
- `ch_7003` — ¥7.350 → **4.924,50 centavos**, o outro meio centavo.

As duas últimas o banco **não** credita separadas: ele paga o lote em uma linha só.

O extrato tem três créditos: **US$ 100,51**, **US$ 97,15** e **US$ 97,14**. Nenhum deles
carrega referência — o banco não sabe o que é um iene, ele só viu dinheiro entrar.

## Por que essa é a resposta certa

`ch_7001` casa sozinho, pela regra `fx_converted`: o par não existe comparando `gross` com
`gross`, porque de um lado há ienes e do outro dólares, e 15.001 nunca vai ser 10.051.

`ch_7002` e `ch_7003` casam **juntos** com o crédito de US$ 97,15, por `group_sum` sobre as
pernas convertidas. E é aqui que o caso separa quem converte de quem copia:

| como o motor faz a conta | resultado |
|---|---|
| converte cada perna, arredonda cada uma, soma: 4790 + 4924 | **9714** |
| soma as pernas convertidas e arredonda o total: 4.790,50 + 4.924,50 = 9.715,00 | **9715** |

A `policy.json` declara `round_after_conversion: true`, e o banco pagou **US$ 97,15**. Quem
arredonda antes de somar erra por um centavo, casa o par errado — o crédito de US$ 97,14 está
lá, esperando — e ainda reporta a linha certa como quebra. Dois erros de um bug só.

O crédito de US$ 97,14 fica sem par, com `no_counterpart_record`. Ele existe no extrato porque
existe: é o valor que o cálculo errado produz, e um arquivo real tem linhas assim.

Repare também no expoente. ¥15.001 são 15.001 unidades mínimas, não 150,01 — quem assume
centavos em toda moeda erra a conversão por um fator de cem e não casa nada. E os dois meios
centavos são `half_even` de verdade: 4.790,50 desce para 4790 e 4.924,50 desce para 4924,
porque o vizinho par é o de baixo nos dois. Meio-para-cima daria 4791 e 4925, que somam 9716 e
não existem em lugar nenhum do extrato.

### `fx.settlement` é por perna, e a soma de duas não é a liquidação do lote

Cada registro declara em `fx.settlement` quanto ele liquida **sozinho**, já arredondado. Somar
os campos declarados das duas pernas dá **9714**, que é justamente a linha isca — o resultado de
arredondar antes de somar. A liquidação do lote é **9715**: converte-se cada perna com o
racional exato, soma-se, e arredonda-se uma vez no fim, que é o que `round_after_conversion:
true` manda fazer.

Não é pegadinha do arquivo: é a propriedade que faz taxa de câmbio doer na prática, e um caso
que não a exercitasse deixaria passar todo motor que trata dinheiro convertido como número que
pode ser somado depois de arredondado. A regra geral está no `SPEC.md`, § "Quatro convenções
que o score compara byte a byte".
