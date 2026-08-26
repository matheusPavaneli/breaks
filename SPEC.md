# breaks — spec

## Tese

Benchmark público de conciliação de liquidação de pagamentos, com motor de referência
determinístico. O ativo central não é o código — é o conjunto versionado de casos que
define o que "conciliação correta" significa. Escrever um motor de casamento virou tarefa
de dois dias; saber contra o que validá-lo, não.

## O que foi verificado (e com que confiança)

| Afirmação | Status |
|---|---|
| Conciliação é trabalho recorrente e universal | Confirmado. A2X: 13.000+ clientes pagando US$ 29–1.039/mês só por isso |
| Camada de plataforma ocupada | Confirmado. Blnk casa registros externos contra ledger interno com regras configuráveis; Formance e Modern Treasury idem |
| Camada de biblioteca sem incumbente | Confirmado. Scripts avulsos, templates n8n, addons Odoo. O tópico "reconciliation" no GitHub é dominado por outro sentido — desambiguação de entidades / linked data |
| Sem benchmark de engenharia para liquidação de PSP | Confirmado. BenchRec = dataset de competição ML (ICAIF 2023), extrato × razão, genérico, sem semântica de payout. FinBalance = benchmark de LLM sobre documentos com OCR — camada errada |
| Janela temporal | Confirmado. Modern Treasury lançou operações de pagamento com IA em maio/2025 — agentes entrando em conciliação sem nada que meça se acertaram |
| Buraco deixado pelo próprio fornecedor | Confirmado na documentação oficial da Stripe: o relatório de conciliação cobre payouts automáticos; em payouts instantâneos a Stripe não identifica quais transações entraram e a responsabilidade fica com o comerciante; payouts manuais não têm relatório transação-a-transação |

O último ponto é a justificativa de existência do projeto — não é opinião de blog de
concorrente, é a doc oficial. **Mas é fato datado**: reconfirmar a cada release do corpus e
registrar em `corpus/timing/*/README.md` a data da consulta e a URL. Se a Stripe fechar o
buraco, o caso continua válido como caso histórico e o README diz isso.

## Componentes

1. **Corpus** — casos versionados, sintéticos, fiéis. Zero dado real.
2. **Engine** — motor determinístico de referência, MIT.
3. **Runner + leaderboard** — qualquer implementação (lib, plataforma, agente) roda e publica score.

## Correções sobre o rascunho inicial

Cinco pontos que quebrariam o projeto, e como ficam resolvidos.

### 1. Circularidade do oráculo

"Motor de referência que passa em 100% do corpus" só significa alguma coisa se o
`expected.json` for independente do motor. Regra: **a verdade nasce primeiro**.

O gerador monta o evento econômico (uma cobrança de X, taxa de Y, liquidada no payout Z),
guarda esse grafo como ground truth, e só então *projeta* duas visões parciais e ruidosas
(`input_a`, `input_b`). O `expected.json` cai do grafo, não do motor. Casos escritos à mão
seguem o mesmo fluxo: narrativa em `README.md` → `expected.json` → inputs.

Consequência prática: o motor de referência é *um participante do benchmark*, com placar
público como qualquer outro. Ele passar em 100% é meta, não definição.

### 2. Contaminação e overfit

Corpus 100% público num repo que agentes de IA leem inteiro = leaderboard sem sinal.

- `corpus/` público, versionado — serve para desenvolver.
- **Holdout privado** gerado pelo mesmo gerador, mesmas distribuições, seeds não publicadas.
  O score oficial roda no holdout. O placar mostra as duas colunas; divergência grande entre
  público e holdout é a evidência de overfit e aparece no site.
- Seeds do holdout rotacionam a cada versão minor do corpus.

### 3. Score único não serve

Uma nota agregada premia exatamente o comportamento que o projeto diz ser pior. O placar
reporta cinco números, sempre juntos, nunca colapsados:

```
true_match        casamento correto proposto
false_match       casamento proposto que está errado          <- o pecado capital
missed_match      par existia, implementação não achou
correct_abstain   caso ambíguo corretamente sinalizado
false_abstain     evidência bastava, implementação se recusou
```

Métrica de ordenação: `settlement_score = true_match − 5·false_match − missed_match`,
normalizada. O peso 5 é convenção do projeto, versionada junto do corpus, e o site sempre
mostra os números brutos ao lado — quem discordar do peso recalcula.

Empate desempata por explicabilidade: fração de decisões com `rule` + `fields_used`
válidos no schema.

### 4. Tolerância é do caso

`policy.json` acompanha cada caso e declara a política que a implementação **deve** obedecer:

```json
{
  "amount_tolerance": { "absolute_minor_units": 2, "basis_points": 0 },
  "time_window": { "before": "PT0S", "after": "P3D" },
  "rounding": "half_even",
  "fx": { "round_after_conversion": true }
}
```

Sem isso, cada implementação afrouxa a tolerância até passar e o benchmark vira teatro.
O runner passa `policy.json` na entrada e considera erro qualquer casamento que viole a
política declarada, mesmo que o par esteja "certo".

### 5. Contrato de runner cross-language

Implementação é um processo, não um módulo. Protocolo:

```
stdin   { "case_id", "policy", "records_a": [...], "records_b": [...] }   JSON, uma linha
stdout  { "matches": [...], "unmatched_a": [...], "unmatched_b": [...], "ambiguous": [...] }
exit 0  saída válida        exit != 0  falha, caso conta como zero
```

Timeout por caso, default 30s, declarado no placar. Sem rede: o runner roda a implementação
com rede desabilitada quando o SO permite, e o placar marca as que exigiram rede. Um
adaptador Node de conveniência embrulha uma função ESM nesse protocolo.

## Schema de registro

```ts
type Money = {
  amount: number      // INTEIRO na menor unidade. nunca float, nunca string
  currency: string    // ISO 4217 alpha-3
  exponent: 0 | 2 | 3 // menor unidade da moeda. JPY=0, USD=2, KWD=3
}

type Ref = {
  type: "charge" | "refund" | "dispute" | "payout" | "transfer"
      | "order" | "invoice" | "external"
  id: string
}

type FxRate = {       // racional exato, jamais decimal
  num: number         // inteiro
  den: number         // inteiro > 0
  from: string        // ISO 4217
  to: string
  quoted_at?: string
}

type SettlementRecord = {
  id: string                    // único dentro de (source_system, source)
  source: "psp" | "bank" | "ledger"
  source_system: string         // "stripe" | "acme_bank" | "netsuite"
  version: number               // >= 1. reprocessamento incrementa (caso E7)
  occurred_at: string           // RFC3339 COM offset. UTC é canônico
  settled_at: string | null     // available_on / data de crédito
  gross: Money                  // sinal explícito: crédito +, débito -
  fee: Money | null             // perna de taxa, sempre separada de gross
  net: Money | null             // gross + fee quando a fonte informa. nunca inferido
  fx: { rate: FxRate; presentment: Money; settlement: Money } | null
  category:
    | "charge" | "refund" | "dispute" | "dispute_reversal" | "fee"
    | "payout" | "payout_failure" | "payout_reversal"
    | "transfer" | "topup" | "adjustment"
  status: "pending" | "available" | "failed" | "reversed"
  references: Ref[]             // tipado. string[] perde a semântica
  metadata: Record<string, string>
}
```

Mudanças versus o rascunho, e por quê:

- `amount: integer` isolado não fecha: `exponent` explícito por moeda, porque JPY não tem
  centavo e KWD tem milésimo. Assumir 2 casas quebra em produção e no corpus.
- `fx_rate: decimal` era float disfarçado. Vira `{ num, den }` — conversão exata, e o caso
  "arredondar antes vs. depois" fica testável de verdade.
- `fx_source_amount` era ambíguo. Vira `presentment` / `settlement` nomeados.
- `references: string[]` → `Ref[]` tipado, senão o motor adivinha o papel de cada id.
- `version` novo: sem ele o caso E7 (registro reprocessado com id novo) não tem como ser
  representado sem gambiarra.
- `occurred_at` com offset obrigatório: o caso E9 (timestamp em fuso errado) precisa de um
  lugar onde o fuso *exista* para poder estar errado.
- `gross` / `fee` / `net` separados: a categoria B inteira depende de perna de taxa nunca
  estar embutida no valor.
- `status` novo: payout falhado e reemitido (A6) e disputa revertida precisam disso.
- Nome do tipo é `SettlementRecord`, não `Record` — `Record` é utilitário do TypeScript.

## Formato de caso

```
corpus/timing/charge-crosses-month-boundary/
  README.md        narrativa financeira. escrito primeiro
  policy.json      política que a implementação deve obedecer
  input_a.json     SettlementRecord[]
  input_b.json     SettlementRecord[]
  expected.json    ground truth
```

`expected.json`:

```json
{
  "matches": [
    { "a": ["ch_1"], "b": ["bt_1"], "rule": "reference", "residual": 0 }
  ],
  "unmatched_a": [{ "id": "ch_2", "reason": "not_yet_settled" }],
  "unmatched_b": [],
  "ambiguous": [
    {
      "a": ["ch_3"],
      "candidates_b": ["bt_7", "bt_8"],
      "reason": "identical_amount_same_minute"
    }
  ]
}
```

`reason` é enum fechado — sem isso, comparar "não casou" entre implementações vira análise
de texto livre.

### Quatro convenções que o score compara byte a byte

O runner compara resíduo e conjuntos por igualdade exata. Quatro coisas ficariam decididas por
acaso pelo primeiro caso que as usasse, e por isso estão fixadas aqui.

**Sinal e moeda do resíduo.** `residual` é sempre `soma do lado A menos soma do lado B`, na
**moeda de liquidação** do par — a moeda em que o lado B está denominado, que em caso cambial
é a moeda para a qual a `fx.rate` converte. Uma cobrança de 10000 contra um crédito de 9999
tem resíduo `+1`, nunca `-1`. Resíduo é `Money`, sempre com moeda; casamento sem diferença
declara `0` naquela moeda, não a ausência do campo.

**Uma entrada de `ambiguous` por conjunto, não por registro.** Quando dois registros do lado A
disputam dois do lado B, isso é **uma** abstenção com quatro ids, não duas abstenções de um
contra dois. O score compara as entradas como conjuntos: a forma por registro descreve a mesma
dúvida e pontua como abstenção errada.

**Referência que aponta para fora do arquivo é normal.** Um caso é uma janela de tempo, e um
registro pode citar uma cobrança de um período anterior que não está em nenhum dos dois lados.
Isso não é `corrupted_reference` — esse motivo é para referência malformada ou que aponta para
algo inutilizável dentro do próprio caso. Referência a um id ausente do arquivo simplesmente
não é evidência utilizável, e o casamento se resolve pelos outros campos.

**`fx.settlement` é por perna e não é somável.** O campo diz quanto *aquele* registro liquida
sozinho, já arredondado. Quando várias pernas liquidam numa única linha do outro lado, o valor
dessa linha **não** é a soma dos `fx.settlement` declarados: com `round_after_conversion: true`
converte-se cada perna com o racional exato, soma-se, e arredonda-se **uma vez** no fim. Somar
valores já arredondados acumula o erro de cada um — é a diferença entre 4790 + 4924 = 9714 e
9.715,00 arredondado a 9715, e o corpus tem casos em que as duas linhas existem no extrato.

### Compatibilidade de categoria

Valor e data batendo não fazem um par. `category` é evidência, e um casamento entre categorias
economicamente incompatíveis é falso mesmo com resíduo zero. As combinações que o corpus trata
como legítimas, do lado A para o lado B:

| lado A | pode liquidar como | por quê |
|---|---|---|
| `charge` | `charge`, `payout` | a venda cruza sozinha, ou dentro do lote que a pagou |
| `refund`, `dispute` | `refund`, `dispute` | dinheiro saindo, do mesmo evento |
| `fee` | `fee` | perna de taxa casa com perna de taxa, nunca com o bruto |
| `payout` | `payout` | o saque e o crédito correspondente |
| `transfer`, `topup` | `transfer`, `topup` | movimento interno ou capital do dono entrando |

O que a tabela recusa é o casamento entre naturezas diferentes — uma venda liquidando contra um
aporte do lojista, um estorno contra uma taxa — e é isso, e não a igualdade de nomes, que a
regra diz. Uma cobrança casando com um payout é normal: o payout é a forma como um lote de
cobranças chega ao banco. `category_mismatch` é o motivo de quem recusa um par por esta tabela.

Categorias fora dela (`dispute_reversal`, `payout_failure`, `payout_reversal`, `adjustment`)
entram com os casos que as usarem, nas fatias seguintes do corpus.

## Corpus v1 — 40 casos

**A. Timing (8)**
1. Cobrança criada dia 31, liquidada dia 2 do mês seguinte
2. Reembolso emitido depois do payout que continha a cobrança original
3. Estorno de disputa lançado 45+ dias após o débito
4. Payout manual sem vínculo transacional (Stripe não fornece)
5. Payout instantâneo sem vínculo transacional (idem)
6. Payout falhado e reemitido
7. Saldo final não liquidado na virada do período
8. Cobrança capturada dias após a autorização

**B. Pernas de taxa (8)**
1. Taxa não devolvida no reembolso — o líquido não espelha o original
2. Taxa de disputa debitada separada do valor disputado
3. Taxa de disputa não estornada mesmo após vitória
4. Application fee em destination charge do Connect
5. Taxa de Radar como balance transaction independente
6. Taxa cross-border embutida
7. Ajuste de taxa retroativo
8. Taxa de payout em moeda diferente da liquidação

**C. Câmbio (7)**
1. Moeda de apresentação ≠ moeda de liquidação, com delta de arredondamento
2. Reembolso parcial com taxa de câmbio diferente da cobrança original
3. Payout multimoeda em um único depósito
4. Arredondar antes vs. depois de converter — separa correto de quase-correto
5. Conversão com taxa nula quando não houve conversão
6. Perda cambial realizada entre cobrança e liquidação
7. Recebimento em stablecoin com taxa de rede

**D. Agrupamento (7)**
1. n:1 — 340 cobranças em um payout, a soma fecha no líquido
2. 1:n — um depósito cobrindo dois payouts
3. Reembolso parcial dividido entre dois payouts
4. Payout com saldo negativo arrastado
5. Payout zerado
6. Transferência entre saldos internos que não é receita nova
7. Batch cobrindo dois períodos contábeis

**E. Adversariais — o resultado correto é "não case" (10)**
1. Duas cobranças de valor idêntico, mesmo minuto, clientes diferentes — sinalizar, não adivinhar
2. Cobrança duplicada real vs. cobrança legítima repetida
3. Delta de um centavo dentro da tolerância vs. centavo genuinamente faltante
4. Registro presente em A e ausente em B — não inventar par
5. Referência corrompida
6. Ordem de webhook invertida
7. Registro reprocessado com id novo
8. Valor negativo mal classificado
9. Timestamp em fuso errado
10. Casamento que fecha por soma mas viola categoria

Categoria E é o coração. Motor gerado em dois dias passa em A–D e falha em E, porque casa
por semelhança em vez de recusar quando a evidência não basta. Em conciliação, falso
positivo é pior que não-casado: o não-casado vai para a fila de exceção, o falso positivo
entra nos livros e ninguém percebe.

**Nota de consistência:** o schema tem `source: "ledger"`, mas v1 é two-way (PSP × banco).
Ou o corpus v1 ganha uma categoria F three-way (PSP × banco × razão), ou `"ledger"` sai do
schema até v2. Decisão default: **manter no schema, sem casos em v1**, documentado aqui —
adicionar campo depois é breaking change, e três-vias é o caso real de quem tem ERP.
Categoria F fica reservada.

## Roadmap MVP — 4 semanas

**Semana 1 — formato e fundação**
- `packages/money` e `packages/schema` (zod), tabela ISO 4217
- Formato de caso + `policy.json` + `expected.json` com `reason` enum
- Runner com o protocolo de processo; adaptador Node
- 12 primeiros casos, à mão, narrativa primeiro

**Semana 2 — motor, núcleo**
- Casamento exato por referência
- Casamento por valor + janela temporal vinda da `policy`
- Tolerância (absoluta e basis points), arredondamento half-even
- Agrupamento n:1
- Saída explicável: `rule`, `fields_used`, `residual`
- Teste de determinismo sob embaralhamento (N seeds)

**Semana 3 — as pernas que quebram todo mundo**
- Separação de perna de taxa (fee, fee_details, taxa não devolvida em reembolso)
- Perna cambial com racional exato; arredondar depois de converter, nunca antes
- Agrupamento 1:n
- Classificação por categoria
- Gerador (`packages/generator`) — ground truth por construção, habilita o holdout
- +28 casos, total 40

**Semana 4 — distribuição**
- CLI `breaks run ./corpus --impl <cmd>`
- Leaderboard estático: quatro números + coluna público/holdout
- Adaptador Stripe: `balance_transactions` × CSV de extrato, sobre fixtures gravados
- Documentação e 3 primeiros textos

## Fora de escopo no MVP

Sem UI. Sem banco. Sem serviço hospedado. Sem ML. Sem multi-tenant. Sem PSP além do
primeiro adaptador. Sem three-way. Tudo isso é v2 ou nunca.

## Riscos abertos

- **Nome.** Resolvido: `breaks`, repo `github.com/matheusPavaneli/breaks`. Escopo npm e domínio
  ainda não verificados — checar antes de publicar pacote ou divulgar.
- **Fidelidade sintética.** Corpus inteiramente sintético pode divergir de dados reais em
  formas que ninguém percebe. Mitigação: cada caso cita a fonte documental (doc de PSP,
  regra contábil) que justifica o comportamento modelado.
- **Legitimidade.** Benchmark só vale se terceiros aceitarem o veredito. O corpus precisa de
  processo de contestação: issue com caso proposto, discussão pública, versão minor.
- **Fatos datados.** As afirmações sobre limitações da Stripe são verdadeiras na data da
  consulta registrada em cada README. Reconfirmar por release.
