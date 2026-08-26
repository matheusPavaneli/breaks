# Arredondar antes vs. depois de converter

**Categoria:** câmbio (C4) · **Moedas:** BHD (expoente 3) → USD (expoente 2)

## A história

Vendas cotadas em dinar do Barein, liquidadas em dólar, à taxa `26525/10000`
— 1 BHD = 2,6525 USD. O dinar tem **três** casas: a unidade mínima é o fil, e
um fil vale 0,26525 centavo de dólar.

**Primeira venda.** `ch_9001` é de 100,002 BHD, ou seja 100.002 fils.
Convertendo o valor cheio: 100.002 × 0,26525 = **26.525,5305 centavos** →
US$ 265,26. Mas quem **arredonda antes de converter** — corta os 2 fils,
trata como 100 BHD redondos e só então multiplica — chega a US$ 265,25.

O extrato tem as duas linhas: **US$ 265,26 e US$ 265,25**. Uma é a liquidação
desta venda. A outra é uma entrada de outro fluxo que por acaso caiu no mesmo
dia com o valor que o cálculo errado produz.

**Segunda e terceira vendas.** `ch_9002` é de 200.000 fils e `ch_9003` é de
200.001 fils. Convertidas: 53.050,00 e 53.050,265 centavos. As duas viram
**US$ 530,50**. O extrato tem **um** crédito de US$ 530,50.

## Por que essa é a resposta certa

A primeira venda casa com US$ 265,26, e a linha de US$ 265,25 fica sem par.
A `policy.json` declara `round_after_conversion: true`: converte-se o valor
inteiro e só o resultado é arredondado. Não há empate aqui — há uma resposta
certa e uma armadilha para quem arredonda na ordem errada. Quem cair nela casa
o par errado **e** reporta a linha certa como quebra: dois erros de um bug só.

O empate real é o segundo. Duas vendas de valores diferentes que a conversão
torna indistinguíveis: as duas afirmam liquidar em US$ 530,50, e existe um
único crédito de US$ 530,50. Nada no arquivo diz qual delas cruzou.

A saída tentadora é "a exata ganha": casar `ch_9002`, que converte redondo, e
deixar `ch_9003` de fora. A `policy.json` não concede isso. Depois do
arredondamento — que é o que ela manda fazer — os dois valores são o mesmo
valor, e preferir um é preferência do motor, não evidência do caso. A resposta
certa é `ambiguous` com motivo `fx_rounding_tie`.
