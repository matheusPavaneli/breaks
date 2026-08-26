# 1:n — um payout chegando como dois créditos

**Categoria:** agrupamento (D2) · **Moeda:** USD

## A história

O gateway emitiu **um** payout de US$ 1.000,00 no dia 14 de julho, com
identificador próprio: `po_1301`.

No extrato ele não aparece como uma linha. O banco correspondente tem um teto
por transferência e partiu o valor em dois créditos no mesmo dia: US$ 600,00 e
US$ 400,00. Nenhum dos dois cita o payout — as referências se perderam na
partição.

Há ainda `bt_1403`, um crédito de US$ 180,00 de um convênio de cobrança que
não passa pelo gateway. Ele não tem nada a ver com este payout, e não há
registro dele do lado A.

## Por que essa é a resposta certa

Um registro do lado A cobrindo dois do lado B: `split_sum`, resíduo zero. É a
imagem espelhada do caso `many-charges-one-payout`, e um motor que só sabe
agrupar do lado esquerdo falha aqui — foi para isso que os dois entraram
juntos no corpus.

`bt_1403` fica como `no_counterpart_record`. A tentação é somá-lo à partição
para "fechar melhor", ou casá-lo sozinho contra o payout inteiro por
proximidade de data. As duas saídas inventam um par que a evidência não
sustenta, e US$ 600 + US$ 400 já fecham exatamente em US$ 1.000 — não sobra
nada para explicar.
