# Duas cobranças de valor idêntico, no mesmo minuto

**Categoria:** adversarial (E1) · **Moeda:** USD

## A história

Às 14:22 do dia 4 de agosto, dois clientes diferentes compraram o mesmo produto. Duas vendas
de **US$ 75,00**, com trinta e um segundos entre elas, mesmo valor, mesma loja, clientes
distintos: `ch_1501` e `ch_1502`.

Uma delas liquidou e virou um crédito de US$ 75,00 no extrato, às 14:25. A outra não — o
cartão do segundo cliente entrou em revisão antifraude e o dinheiro só sai amanhã. O arquivo
do gateway ainda não sabe disso: as duas vendas estão `available`, cada uma com o próprio
`settled_at`, e nada no arquivo diz qual das duas o banco recebeu.

No mesmo período há uma terceira venda, `ch_1503`, de US$ 99,00, cujo crédito no extrato cita
a cobrança.

## Por que essa é a resposta certa

`ch_1503` casa por referência e sai da conversa.

Sobram duas vendas idênticas e um crédito. **Nada no arquivo distingue as duas.** Mesmo valor,
mesmo minuto, mesma janela, nenhuma referência. A diferença que existiria — qual cliente pagou
— não está em nenhum campo que a conciliação enxerga, e não deveria estar: o corpus não
carrega dado de cliente.

A resposta certa é `ambiguous`, com as duas cobranças de um lado e o crédito como candidato do
outro, motivo `identical_amount_same_minute`.

### Proximidade no tempo não é evidência

Os dois `settled_at` não são iguais — 14:22:10 e 14:22:41 — e o crédito caiu às 14:25. Um
motor que desempata pelo mais próximo tem, sim, um número para comparar: 2m19s contra 2m50s.
Ele vai escolher `ch_1502`, e vai estar certo metade das vezes.

Trinta e um segundos não são evidência de nada. A ordem em que duas vendas do mesmo minuto
são liquidadas não determina a ordem em que os créditos aparecem no extrato: entre as duas
coisas há fila de lote, corte de horário do banco e um pipeline que não preserva ordem. A
`policy.json` declara uma janela de três dias justamente porque essa distância é ruído dentro
dela; tratar o ruído como desempate é transformar aleatoriedade em conclusão contábil.

É esse o ponto do caso. O não-casado vai para a fila de exceção e alguém olha. O falso
positivo entra na contabilidade e ninguém olha. Por isso, no `SPEC.md`, abster pesa menos que
errar.
