# Taxa não devolvida no reembolso

**Categoria:** pernas de taxa (B1) · **Moeda:** USD

## A história

Uma venda de US$ 200,00 no dia 5 de maio. O gateway cobra US$ 5,90 de taxa, e
o banco lança as duas coisas separadas: crédito de US$ 200,00 e débito de
US$ 5,90 no mesmo dia.

No dia 10 o cliente pede reembolso e a loja devolve os US$ 200,00 inteiros.
O banco debita US$ 200,00.

**A taxa não volta.** O gateway devolveu o valor da venda, não a taxa que
cobrou por processá-la. O reembolso sai com `fee` igual a **zero** — e zero
aqui é um fato, não a ausência de informação: a fonte disse que a taxa devolvida
foi nenhuma.

Ao fim da operação a loja movimentou US$ 200,00 para dentro e US$ 200,00 para
fora, e está US$ 5,90 mais pobre.

## Por que essa é a resposta certa

Três pares, três justificativas diferentes:

1. `ch_3001` ↔ `bt_4001` por **referência**: o crédito cita a cobrança.
2. `fee_3002` ↔ `bt_4002` pela regra **`fee_leg`**. A taxa é uma perna própria,
   com registro próprio dos dois lados. Ela não é subtraída do bruto da venda
   nem embutida no par de cima: bruto e taxa são fatos separados, e juntá-los
   destrói a informação que o caso existe para preservar.
3. `rf_3003` ↔ `bt_4003` por **referência**: o débito cita o reembolso.

O erro clássico é conciliar o reembolso contra o **líquido** da cobrança
(US$ 194,10) e reportar um resíduo de US$ 5,90 como quebra. Não há quebra: o
reembolso é de US$ 200,00 dos dois lados, resíduo zero. A taxa não devolvida
não é um erro de conciliação, é o custo do serviço — e ela já foi conciliada
no par 2, no dia em que foi cobrada.

Observe a diferença entre `"fee": null` em `ch_3001` (a linha da venda não
reporta a perna de taxa; ela vem no registro próprio) e `"fee": 0` em
`rf_3003` (a fonte reporta que a taxa devolvida foi zero). São fatos
diferentes, e o schema recusa confundir os dois.
