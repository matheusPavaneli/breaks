# Registro presente em A e ausente em B

**Categoria:** adversarial (E4) · **Moeda:** USD

## A história

Dia 18 de agosto. O gateway registra duas vendas:

- `ch_1901`, de US$ 123,45, que liquidou e aparece no extrato com referência.
- `ch_1902`, de US$ 50,00, que o gateway marca como liquidada — mas **o crédito
  nunca chegou ao banco**. O arquivo do extrato foi extraído completo e não tem
  nenhuma linha desse valor, nem nada próximo.

Do lado do banco há `bt_2002`, um crédito de US$ 81,23 vindo de uma máquina de
cartão de loja física, que não passa pelo gateway. Não existe registro dele do
lado A, e não deveria existir.

## Por que essa é a resposta certa

Um par casa por referência. Os outros dois registros ficam sem par, cada um com
`no_counterpart_record`, e é só isso que o caso pede.

Parece trivial e não é: é o caso mais barato de errar do corpus. Dois registros
órfãos no mesmo período, um de cada lado, com valores diferentes. Um motor que
insiste em fechar o arquivo — que trata "sobrou dos dois lados" como sinal de
que os dois devem se casar — pareia US$ 50,00 com US$ 81,23 e reporta um
resíduo de US$ 31,23 como se fosse uma quebra explicável.

Não é. São dois fatos independentes: dinheiro que sumiu no caminho, e dinheiro
que entrou por outro caminho. O primeiro é um problema real que alguém precisa
investigar; o segundo é normal. Casar os dois esconde os dois.

Sobrar não é sinal de que falta casar. Às vezes sobra porque sobra.
