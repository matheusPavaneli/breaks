# Arredondar antes vs. depois de converter

**Categoria:** câmbio (C4) · **Moedas:** BHD (expoente 3) → USD (expoente 2)

## A história

Vendas cotadas em dinar do Barein, liquidadas em dólar, à taxa `26525/10000` — 1 BHD =
2,6525 USD. O dinar tem **três** casas: a unidade mínima é o fil, e um fil vale 0,26525
centavo de dólar. Uma moeda mais fina liquidando numa mais grossa é onde o arredondamento
deixa de ser detalhe.

**As duas vendas do lote da manhã.** `ch_9001` é de 100.002 fils e `ch_9004` é de 100.003
fils. Convertidas exatas: **26.525,5305** e **26.525,79575** centavos. O banco pagou as duas
em uma linha só.

**As duas vendas grandes.** `ch_9002` é de 200.000 fils e `ch_9003` é de 200.001 fils.
Convertidas: 53.050,00 e 53.050,26525 centavos. As duas viram **US$ 530,50**, e o extrato tem
**um** crédito de US$ 530,50.

No extrato: **US$ 530,51**, **US$ 530,52** e **US$ 530,50**.

## Por que essa é a resposta certa

**O lote da manhã casa com US$ 530,51.** A soma exata das duas pernas é 53.051,32625 centavos,
que arredonda para 53051. A `policy.json` declara `round_after_conversion: true`: converte-se
o valor inteiro e só o resultado final é arredondado.

Quem arredonda **antes** — cada perna para o centavo, 26526 e 26526, e só então soma — chega a
**53052**, e essa linha está no extrato. Não há empate aqui: há uma resposta certa e uma
armadilha para quem faz a conta na ordem errada. Cair nela custa duas vezes, porque casa o par
errado e reporta o crédito certo como quebra.

O crédito de US$ 530,52 fica com `no_counterpart_record`.

**As duas vendas grandes são um empate de verdade.** Valores de origem diferentes, 200.000 e
200.001 fils, que a conversão torna indistinguíveis: as duas liquidam em US$ 530,50, e existe
um único crédito de US$ 530,50. Nada no arquivo diz qual delas cruzou.

A saída tentadora é "a exata ganha": casar `ch_9002`, que converte redondo, e deixar `ch_9003`
de fora. A `policy.json` não concede isso. Depois do arredondamento — que é o que ela manda
fazer — os dois valores são o mesmo valor, e preferir um é preferência do motor, não evidência
do caso. A resposta certa é `ambiguous`, motivo `fx_rounding_tie`.

### `fx.settlement` é por perna, e a soma de duas não é a liquidação do lote

Cada registro declara em `fx.settlement` quanto ele liquida **sozinho**, já arredondado. Somar
os campos declarados das duas pernas dá **53052**, que é justamente a linha isca — o resultado de
arredondar antes de somar. A liquidação do lote é **53051**: converte-se cada perna com o
racional exato, soma-se, e arredonda-se uma vez no fim, que é o que `round_after_conversion:
true` manda fazer.

Não é pegadinha do arquivo: é a propriedade que faz taxa de câmbio doer na prática, e um caso
que não a exercitasse deixaria passar todo motor que trata dinheiro convertido como número que
pode ser somado depois de arredondado. A regra geral está no `SPEC.md`, § "Cinco convenções
que o score compara byte a byte".
