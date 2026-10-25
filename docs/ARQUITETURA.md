# Arquitetura, decisões e riscos — Entrega 1

## Diagnóstico inicial (Fase 0)

- Repositório vazio (branch sem commits). Node 22.22.0, npm 10.9.4, Chromium/Playwright e ffmpeg disponíveis no ambiente do agente.
- Sem acesso a câmera nem a aparelhos físicos → QA físico **PENDENTE**, substituído parcialmente por E2E com câmera simulada.

## Fluxo

```
[Iniciar] ──gesto──▶ fetch .mind ─▶ WebGLRenderer ─▶ getUserMedia(environment)
                                                         │
                         MindAR Controller (TF.js WebGL + worker) ◀── <video>
                                   │ updateMatrix(targetIndex, worldMatrix|null)
                                   ▼
             âncora Three.js (matrix = world × post) ── visible ──▶ efeitos.update(dt)
                                   │
                    TrackingStateMachine ──▶ StatusOverlay (HUD/dicas/erros)
```

Espaço da âncora: largura do alvo = 1, origem no centro da obra, +Z saindo da superfície.

## Decisões

| Decisão | Motivo | Trade-off |
| --- | --- | --- |
| Vite + TypeScript strict, sem framework de UI | Plano (MVP leve); DOM simples | Migração p/ Next.js na fase 2 |
| MindAR 1.2.5 `Controller` + integração Three.js própria | `MindARThree` importa `sRGBEncoding` (removido no Three r162) → quebra com Three 0.186; também engolia o erro do getUserMedia (sem distinguir NotAllowed/NotFound) e não removia o listener de resize | Mantemos ~100 linhas de cálculo de FOV/resize portadas do MindAR |
| Interface `TrackingEngine` | Trocar SDK sem tocar UI/efeitos (seção 12) | Uma camada a mais |
| Import dinâmico do MindAR | Tela inicial carrega só Three + app (~142 KB gzip); motor (~283 KB gzip) baixa no clique | Pequena espera extra ao iniciar (com loading) |
| `canvas` substituído por stub via `overrides` | Dependência nativa só usada no compilador Node; quebrava `npm install` | Compilação do alvo feita em Chromium (Playwright) |
| Arte gerada por código (seed fixa) | Original, reprodutível, sem IP de terceiros; rica em cantos | Estética "gerativa"; trocar pela obra de artista no piloto |
| Efeitos procedurais (sem GLB) | Zero downloads extras, geometria leve (3 draw calls principais + pontos) | Menos expressivo que modelos autorais |
| Recriar motor ao girar o aparelho | O Controller fixa largura/altura de entrada; a câmera troca as dimensões na rotação | 1–2 s sem rastreamento após girar |
| `video.width/height` = dimensões do stream | `tf.browser.fromPixels` usa os atributos, não `videoWidth`; sem isso nada é detectado (bug encontrado no E2E) | — |
| CSP estrita (`script-src 'self'`, `worker-src blob:`) | Seção 09; MindAR usa workers inline (blob) | Qualquer CDN futura precisa entrar na política |

## Etapa 2 — obras do usuário + IA (após o teste em campo)

Feedback do teste no iPhone: (1) só reconhecia a arte de exemplo; (2) ao apontar para outra obra, ficava em "Procurando…" sem explicar; (3) efeitos genéricos, sem relação com a obra.

| Problema | Solução |
| --- | --- |
| Obra fixa | Cadastro pelo usuário: recorte com detecção automática de cantos (máscara por cores da borda + abertura/fechamento morfológico + maior componente + verificação de preenchimento) e correção de perspectiva (homografia); compilação do `.mind` no navegador; obras no IndexedDB. |
| Sem explicação | Miniaturas das obras procuradas no HUD; `FrameAdvisor` mede luminância, estouro, movimento e nitidez do vídeo (96×72, local) e dá a dica mais útil; após 12 s sugere que a obra pode não estar cadastrada. |
| Efeitos genéricos | Efeitos derivados da imagem: camadas por cor (paleta k-means, classificação sobre imagem desfocada + filtro de maioria) que sobem com sombra; partículas nas cores da obra nascendo dos pontos de detalhe; aura; objeto 3D no ponto de interesse. |
| "Inteligente" | Nota de reconhecimento a partir dos pontos reais do compilador (quantidade, cobertura) + contraste/nitidez, com dicas. Claude (`api/analyze.ts`) sugere título, descrição acessível, legenda, clima e efeitos. |
| Uma obra por vez | Vários `.mind` unidos sem recompilar (`mergeTargets`); uma âncora por obra; até 8 simultâneas. |
| Perda/flicker | `warmupTolerance` 3 e `missTolerance` 8 (padrão 5/5). |

Bug encontrado e corrigido pelo E2E: a junção parede/mesa (transição borrada) era detectada como parte da obra, gerando recorte errado e alvo que não reconhecia. Corrigido com abertura morfológica e rejeição de quadriláteros pouco preenchidos.

## Contratos implementados (seção 06)

- AR só inicia após clique; loading em três etapas (assets, câmera, motor).
- `targetFound` → âncora visível, animação de entrada, HUD "Obra reconhecida", timestamp local em `state.log`.
- `targetLost` → âncora oculta (nada fica preso na tela), HUD + dica de reposicionamento.
- Resize/rotação → renderer + FOV; motor recriado quando as dimensões do vídeo mudam.
- Desmontagem → `setAnimationLoop(null)`, `controller.dispose()` + `worker.terminate()`, tracks paradas, geometrias/materiais/renderer liberados, listeners removidos; também em `pagehide`.
- Erros → `NotAllowedError`, `NotFoundError`/`OverconstrainedError`, `NotReadableError`, contexto inseguro, sem `getUserMedia`, sem WebGL, `.mind` ausente, falha do motor, genérico.
- Aba oculta → processamento pausado.
- Animações com delta time (limitado a 100 ms); `prefers-reduced-motion` reduz velocidade e partículas.
- Pixel ratio limitado a 2; buffers de partículas reaproveitados (sem alocação no loop).

## Validação executada

| Item | Comando | Resultado observado |
| --- | --- | --- |
| Instalação limpa | `npm ci` | ok (com stub de `canvas`) |
| Typecheck | `npm run typecheck` | 0 erros |
| Unitários | `npm test` | 14/14 (Vitest 5.0.5) |
| CI GitHub Actions | `.github/workflows/ci.yml` | verde em `npm ci` limpo |
| Telas | screenshots (desktop 1280, celular 390, paisagem 844×390, imprimir) | sem erros de console; folha A4 = 1 página no PDF |
| Build | `npm run build` | ok; `index` 552 KB (142 KB gzip), `mindar` 1,05 MB (283 KB gzip, lazy) |
| Compilação do alvo | `npm run target` | `.mind` 929 KB em ~11 s |
| Detecção isolada | script de diagnóstico (canvas estático 640×480) | 773/773 atualizações com alvo encontrado em 15 s |
| E2E câmera simulada | `npm run test:e2e` | scanning (1,9 s) → found (2,6 s) → lost (7,8 s) → found (10,1 s), coerente com a linha do tempo do vídeo; câmera encerrada ao sair; modo demo; 0 violações de CSP; ~29 fps com renderização por software |
| Cabeçalhos | `vite preview` + `curl -I` | CSP e Permissions-Policy presentes |

Não executado: dispositivos reais, medição de FPS em GPU móvel, testes de luz/reflexo — ver `tests/smoke-checklist.md`.

## Riscos e mitigação

| Risco | Situação | Mitigação |
| --- | --- | --- |
| MindAR sem manutenção ativa (1.2.5 é de 2024) e acoplado a TF.js 4 | Real | Interface `TrackingEngine`; avaliar alternativas (ex.: 8th Wall descontinuado; WebXR image tracking ainda experimental) no M2 |
| Compatibilidade iOS Safari (WebGL/TF.js, memória) | Não verificado | QA físico; mensagens de erro claras; modo demo como fallback |
| Jitter/perda em luz ruim ou impressão brilhante | Esperado | Papel fosco, dicas na UI, ajuste de `filterMinCF/filterBeta` após medições |
| Aquecimento/bateria | Não medido | Pausa em segundo plano; pixel ratio ≤ 2; geometria simples |
| Arte gerativa ≠ pintura real (textura, verniz, tamanho) | Real | Gate do plano: validar com pinturas reais antes do editor |
| `.mind` grande (930 KB) | Aceitável | Reduzir resolução da fonte (ex.: 900 px) se o tempo de carga em 4G passar da meta |

## Próximo marco

M1 → aceite em iOS e Android reais (preencher o checklist). Depois: M2 piloto com 3–5 obras reais (ver `docs/BACKLOG.md`).
