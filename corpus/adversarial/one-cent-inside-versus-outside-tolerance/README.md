# Um centavo dentro da tolerância vs. um centavo faltando de verdade

**Categoria:** adversarial (E3) · **Moeda:** USD

## A história

A `policy.json` deste caso declara tolerância de **uma unidade mínima** —
um centavo — e zero basis points. O banco correspondente arredonda o câmbio de
uma conta intermediária e o resultado é que valores chegam com desvio de até um
centavo. A loja aceitou isso por contrato.

Três vendas, e o extrato do mesmo dia:

- `ch_1701`, de US$ 100,00 → crédito de **US$ 99,99**. Um centavo a menos.
- `ch_1702`, de US$ 200,00 → crédito de **US$ 199,98**. Dois centavos a menos.
- `ch_1703`, de US$ 300,00 → e no extrato há **dois** créditos vizinhos:
  US$ 299,99 e US$ 300,01. Um centavo para baixo e um para cima.

## Por que essa é a resposta certa

**Primeiro par: casa.** A diferença é de um centavo, a tolerância é de um
centavo, e a regra é `amount_within_tolerance`. O resíduo **não é zero** — é
um centavo, e vai escrito no `expected.json` como dinheiro com moeda. Um
casamento dentro da tolerância que declara resíduo zero está mentindo sobre o
que aconteceu; a diferença existe, foi aceita, e continua precisando aparecer
no relatório.

**Segundo par: não casa.** Dois centavos passam da tolerância declarada. Os
dois lados ficam sem par, com motivo `amount_beyond_tolerance` — que é
diferente de "não achei contrapartida": achou-se um candidato óbvio, e ele foi
recusado pela política do caso. Quem lê a fila de exceção precisa dessa
distinção para saber que aqui há dinheiro faltando de verdade.

**Terceiro: abstém.** Os dois créditos estão dentro da tolerância, um de cada
lado do valor. A tolerância admite os dois, e nada no caso escolhe entre eles.
`ambiguous`, motivo `multiple_candidates_within_tolerance`.

A saída errada mais comum é pegar o mais próximo — os dois estão à mesma
distância — ou o primeiro da lista. Tolerância não é critério de desempate:
ela diz o que é aceitável, não o que é verdadeiro.

### O sinal do resíduo faz parte da resposta

O par que casa dentro da tolerância declara `residual` de **+1 centavo**, e o sinal não é
detalhe de apresentação: o resíduo é `soma do lado A menos soma do lado B`, sempre nessa
ordem, na moeda de liquidação. A cobrança é 10000, o crédito é 9999, então o resíduo é `+1`.

Uma implementação que calcule `B − A` chega a `-1`, aponta o par certo, faz a aritmética certa
— e é pontuada como falso casamento, porque o runner compara resíduo por igualdade exata. A
convenção está no `SPEC.md`, § "Cinco convenções que o score compara byte a byte"; este é o
primeiro caso do corpus em que ela é visível.
