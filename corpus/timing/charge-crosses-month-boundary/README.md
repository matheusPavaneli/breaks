# Cobrança criada dia 31, liquidada dia 2 do mês seguinte

**Categoria:** timing (A1) · **Moeda:** USD

## A história

A loja fechou março com três vendas nas últimas horas do dia 31. O gateway
registra a venda no instante em que o cliente paga; o dinheiro só cruza para o
banco quando o lote do dia é liquidado, dois dias depois. As três vendas nascem
em março e duas delas chegam ao extrato em abril.

- `ch_1001` — venda de US$ 125,00 às 18:40 do dia 31. Liquidada dia 2 de abril.
  O banco creditou o líquido, US$ 121,05, e o extrato carrega a referência à
  cobrança.
- `ch_1003` — venda de US$ 91,00 às 20:00 do dia 31, liquidada no mesmo lote do
  dia 2. O crédito de US$ 87,90 entrou no extrato **sem referência nenhuma**:
  o banco só informa valor e data.
- `ch_1002` — venda de US$ 64,00 às 23:58 do dia 31. O lote fechou antes dela.
  No fim do período ela ainda está `pending`, sem `settled_at`. Nenhum crédito
  no extrato corresponde a ela, e isso não é um erro.

## Por que essa é a resposta certa

`ch_1001` casa por **referência**: o extrato diz de qual cobrança aquele crédito
veio. Não há o que interpretar.

`ch_1003` não tem referência, então só sobra valor e janela. O líquido da
cobrança (8790) é igual ao bruto do crédito (8790), e a liquidação caiu dois
dias depois da venda — dentro da janela de `P3D` que a `policy.json` declara.
Nenhuma outra cobrança do arquivo tem esse valor, então o par é único.

`ch_1002` **não casa com nada**, e a resposta certa é dizer isso com o motivo:
`not_yet_settled`. A tentação é parear com o crédito de US$ 87,90 porque a data
é próxima — mas o valor não bate, e o registro nem sequer foi liquidado.

A virada de mês é o que torna o caso difícil: quem filtra por competência
mensal perde as duas liquidações de abril e reporta março inteiro como não
conciliado.

## Fonte

A defasagem entre a criação da cobrança e a data em que o dinheiro fica disponível é o campo
`available_on` da balance transaction, e é o que a virada de mês deste caso exercita.

- **Consultado em:** 2026-08-26
- **URL:** https://docs.stripe.com/reports/payout-reconciliation
- **Página:** "Relatório de reconciliação de repasses"

> A seção **Reconciliação de saldo final** detalha as transações que não haviam sido liquidadas
> na data final do relatório.

É o `ch_1002` deste caso: criado dentro do período, não liquidado até o fim dele, e por isso
`not_yet_settled` em vez de quebra.
