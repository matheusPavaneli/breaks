# Taxa de disputa debitada separada do valor disputado

**Categoria:** pernas de taxa (B2) · **Moeda:** USD

## A história

Um cliente contesta uma compra de US$ 300,00 no cartão. O gateway faz duas
coisas no mesmo instante e **elas não andam juntas**:

- `dp_5001` — debita os US$ 300,00 disputados do saldo da loja. O banco lança
  esse débito no mesmo dia e cita a disputa.
- `fee_5002` — debita **US$ 15,00 de taxa de disputa**, que é o que o gateway
  cobra para processar a contestação. Essa taxa não é lançada isolada no
  extrato: ela fica retida no saldo do gateway e só aparece no banco embutida
  no próximo payout, que cai no período seguinte.

O extrato do período tem uma linha de US$ 300,00 e mais nada.

## Por que essa é a resposta certa

O valor disputado casa por referência, resíduo zero.

A taxa de disputa **não casa com nada, e isso é o resultado correto**:
`fee_leg_only`. É uma perna de taxa que existe sozinha neste período, sem perna
bruta e sem contrapartida no extrato.

A saída errada que o caso cobra é **casar a taxa com o débito de US$ 300,00**, tratando os
dois como o mesmo evento porque compartilham a mesma disputa. São dois fatos financeiros, e
somá-los faz o extrato parecer ter movimentado US$ 315,00. Isso é um falso casamento, e o
score cobra por ele.

Reportar `no_counterpart_record` em vez de `fee_leg_only` é impreciso pelo mesmo motivo que o
`reason` existe: a linha órfã é uma taxa, vai aparecer no extrato do próximo período, e quem
lê a fila de exceção precisa saber disso para não abrir chamado. Mas é honesto dizer o que o
placar faz hoje: os cinco contadores do `SPEC.md` § "Score único não serve" não leem
`unmatched_a` nem `unmatched_b`, então trocar esse motivo não muda nota nenhuma. O campo é a
verdade do caso e a entrada da fila de exceção, não uma armadilha pontuada.

### `ch_5000` não está no arquivo, e isso é normal

`dp_5001` referencia a cobrança `ch_5000`, que não aparece em nenhum dos dois lados. A compra
contestada é de dois meses atrás — um caso é uma janela de tempo, e a cobrança original ficou
para trás dela. Nenhum arquivo de conciliação real contém toda a história de cada disputa.

Isso **não** é `corrupted_reference`. A referência é bem formada e verdadeira; ela só aponta
para fora da janela. `corrupted_reference` é para referência malformada, ou que aponta para
algo inutilizável dentro do próprio caso. Motor que trata "não achei o id" como corrupção
perde um par que a referência da disputa já resolvia. A regra geral está no `SPEC.md`,
§ "Três convenções que o score compara byte a byte".
