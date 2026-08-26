# Fecha por soma, mas as categorias se contradizem

**Categoria:** adversarial (E10) · **Moeda:** USD

## A história

Dia 25 de agosto, duas coisas de US$ 120,00 acontecem no mesmo dia:

- `ch_2101` — uma venda de US$ 120,00 no gateway, liquidada no mesmo dia,
  sem referência no extrato.
- `bt_2201` — no banco, um crédito de US$ 120,00 categorizado como **`topup`**:
  é a própria loja transferindo dinheiro para o saldo do gateway, para cobrir
  reembolsos futuros. Dinheiro do dono entrando, não receita de cliente.

Valor igual, dia igual, janela igual, nenhum dos dois com referência.

No mesmo arquivo há um par que casa sem drama: `ch_2102`, de US$ 74,00, cujo
crédito no extrato cita a cobrança.

## Por que essa é a resposta certa

O par tentador **não é um par**. A venda e o aporte se parecem em tudo que a
aritmética enxerga e se contradizem no que importa: uma é receita liquidando,
a outra é capital entrando. Casá-los faz duas mentiras ao mesmo tempo — a
venda aparece como recebida quando o dinheiro dela ainda não chegou, e o aporte
some da conta de capital.

Os dois ficam sem par, com motivo `category_mismatch`. O motivo é o registro de por que a
recusa aconteceu: não é "não achei" nem "está fora da tolerância" — achou-se um candidato de
valor exato, e ele foi recusado porque a natureza dos dois lançamentos é incompatível. É essa
frase que a fila de exceção precisa ler.

O que o caso cobra hoje é o casamento que **não** deve existir: os cinco contadores do
`SPEC.md` § "Score único não serve" contam casamentos e abstenções, e não leem `unmatched_a`
nem `unmatched_b`. Casar as duas linhas custa dois falsos casamentos; escolher o motivo errado
para elas, por enquanto, não custa nada no placar. A `reason` está aqui porque é a verdade do
caso e porque `breaks verify` e a fila de exceção a consomem — não porque o score a puna.

É a regra geral que o caso quer instalar: **valor e data não bastam.**
Categoria é evidência, e evidência que contradiz derruba um casamento que a
soma aprovaria. Um motor que só compara números fecha este arquivo com 100% de
casamento e 100% de erro nas duas linhas que importam.
